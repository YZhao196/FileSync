//! Runs the provisioning script and reports progress.
//!
//! Progress is *polled* rather than pushed as Tauri events, deliberately: the
//! frontend talks to the shell through `invoke` alone (see `native/bridge.ts`),
//! and subscribing to events would mean adding the JS API package back — the
//! one dependency that file exists to avoid. A status snapshot is cheap and
//! loses nothing here.
//!
//! The script itself is `infra/provision/provision.sh`, embedded at compile
//! time so the binary is self-contained. Its stdout protocol is one
//! tab-separated `step<TAB>state<TAB>detail` line per event.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionConfig {
    photos_folder: String,
    files_folder: String,
    tailscale_name: String,
    /// "fresh" | "sync" | "restore"
    transfer: String,
    source_address: Option<String>,
    /// Backup target. All optional — provisioning without a cloud target is a
    /// working server with no off-site copy, which is a state worth allowing
    /// and worth warning about.
    b2_bucket: Option<String>,
    b2_key_id: Option<String>,
    b2_app_key: Option<String>,
    restic_password: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionEvent {
    step: String,
    /// "start" | "ok" | "skipped" | "failed"
    state: String,
    detail: Option<String>,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionRun {
    running: bool,
    done: bool,
    failed: bool,
    events: Vec<ProvisionEvent>,
}

#[derive(Default)]
pub struct ProvisionState(pub Arc<Mutex<ProvisionRun>>);

const SCRIPT: &str = include_str!("../../../infra/provision/provision.sh");

/// Parses one line of the script's output. Unknown lines are dropped rather
/// than shown: the script writes its own diagnostics to stderr.
fn parse_line(line: &str) -> Option<ProvisionEvent> {
    let mut parts = line.splitn(3, '\t');
    let step = parts.next()?.trim();
    let state = parts.next()?.trim();
    if step.is_empty() || !matches!(state, "start" | "ok" | "skipped" | "failed") {
        return None;
    }
    let detail = parts.next().map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    Some(ProvisionEvent {
        step: step.to_string(),
        state: state.to_string(),
        detail,
    })
}

#[tauri::command]
pub fn start_provision(
    config: ProvisionConfig,
    state: tauri::State<'_, ProvisionState>,
) -> Result<(), String> {
    {
        let mut run = state.0.lock().map_err(|e| e.to_string())?;
        if run.running {
            return Err("Provisioning is already running".into());
        }
        *run = ProvisionRun {
            running: true,
            ..Default::default()
        };
    }

    if !cfg!(target_os = "linux") {
        let mut run = state.0.lock().map_err(|e| e.to_string())?;
        run.running = false;
        run.done = true;
        run.failed = true;
        run.events.push(ProvisionEvent {
            step: "preflight".into(),
            state: "failed".into(),
            detail: Some(
                "Provisioning runs on the server itself, and only on Linux. \
                 Use this machine as a client instead."
                    .into(),
            ),
        });
        return Ok(());
    }

    let shared = Arc::clone(&state.0);

    // Detached from the request: the app polls, and a long install must not
    // hold a command open. The child is left to finish on its own.
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let script_path = std::env::temp_dir().join("filesynapse-provision.sh");
            std::fs::write(&script_path, SCRIPT).map_err(|e| format!("could not write script: {e}"))?;

            // Secrets reach the script as environment variables and are never
            // given to `echo` or written by this side. The script itself writes
            // the Backblaze and restic values to a root-owned 0600 file on the
            // server, which is where they belong.
            let mut command = Command::new("sudo");
            command
                .arg("bash")
                .arg(&script_path)
                .env("PHOTOS_DIR", &config.photos_folder)
                .env("FILES_DIR", &config.files_folder)
                .env("TAILSCALE_NAME", &config.tailscale_name)
                .env("TRANSFER", &config.transfer)
                .env("SOURCE_ADDRESS", config.source_address.clone().unwrap_or_default())
                .env("B2_BUCKET", config.b2_bucket.clone().unwrap_or_default())
                .env("B2_KEY_ID", config.b2_key_id.clone().unwrap_or_default())
                .env("B2_APP_KEY", config.b2_app_key.clone().unwrap_or_default())
                .env("RESTIC_PASSWORD", config.restic_password.clone().unwrap_or_default())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());

            let mut child = command.spawn().map_err(|e| format!("could not start: {e}"))?;

            if let Some(stdout) = child.stdout.take() {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(event) = parse_line(&line) {
                        if let Ok(mut run) = shared.lock() {
                            run.events.push(event);
                        }
                    }
                }
            }

            let status = child.wait().map_err(|e| format!("could not wait: {e}"))?;
            if !status.success() {
                return Err(format!("the provisioning script exited with {status}"));
            }
            Ok(())
        })();

        if let Ok(mut run) = shared.lock() {
            run.running = false;
            run.done = true;
            if let Err(message) = result {
                run.failed = true;
                run.events.push(ProvisionEvent {
                    step: "provisioning".into(),
                    state: "failed".into(),
                    detail: Some(message),
                });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn provision_status(state: tauri::State<'_, ProvisionState>) -> Result<ProvisionRun, String> {
    state.0.lock().map(|r| r.clone()).map_err(|e| e.to_string())
}
