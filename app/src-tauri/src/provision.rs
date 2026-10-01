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
    /// The name everything reaches this server by. On a replacement this is the
    /// *real* name, even though the machine joins under a temporary one — the
    /// services it configures have to answer to the name they will be reached by.
    tailscale_name: String,
    /// Set only while replacing another server: the machine joins the tailnet
    /// under this instead, so the working server keeps answering until the copy
    /// has been verified. Empty on a fresh install.
    tailscale_temp_name: Option<String>,
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

/// The host agent, embedded so provisioning can deploy it without a terminal.
///
/// `provision.sh` cannot carry these itself. Its step bodies are double-quoted
/// shell strings, where a backtick is command substitution that *runs* — which
/// is why the file forbids them outright, and `agent.mjs` contains twenty-three.
/// Escaping them all would be a losing game against the next edit. Embedding
/// here means the real files go to the server with nothing between them and it.
///
/// `infra/agent/layla/` is deliberately absent: it is the optional decision
/// model, behind a compose profile, and compose does not build it unless asked.
/// The test scripts are absent too — the Dockerfile copies `*.mjs`, so leaving
/// them out is also what keeps them out of the image.
const AGENT_FILES: &[(&str, &str)] = &[
    ("Dockerfile", include_str!("../../../infra/agent/Dockerfile")),
    (
        "docker-compose.yml",
        include_str!("../../../infra/agent/docker-compose.yml"),
    ),
    (".dockerignore", include_str!("../../../infra/agent/.dockerignore")),
    ("agent.mjs", include_str!("../../../infra/agent/agent.mjs")),
    (
        "captionStore.mjs",
        include_str!("../../../infra/agent/captionStore.mjs"),
    ),
    ("containers.mjs", include_str!("../../../infra/agent/containers.mjs")),
    ("decisions.mjs", include_str!("../../../infra/agent/decisions.mjs")),
];

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

/// Whether sudo will run without stopping to ask for a password.
///
/// `-n` makes sudo fail rather than prompt, which is exactly the question being
/// asked: not "is this user an administrator" but "can this run unattended".
/// A cached timestamp from a recent `sudo -v` counts, which is what makes the
/// advice above actionable.
fn can_sudo_unattended() -> bool {
    Command::new("sudo")
        .args(["-n", "true"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

    // sudo needs a terminal to ask for a password, and an app launched from a
    // menu does not have one. Without this the run starts, dies immediately and
    // reports "exit status 1" — the explanation being a line on a stderr nobody
    // can see. Checked before anything is claimed to have started.
    //
    // Refusing is right in every case the check fails, including sudo being
    // absent: the command below invokes sudo regardless, so it would fail
    // either way. What changes is that the user is now told why.
    if !can_sudo_unattended() {
        let mut run = state.0.lock().map_err(|e| e.to_string())?;
        run.running = false;
        run.done = true;
        run.failed = true;
        run.events.push(ProvisionEvent {
            step: "preflight".into(),
            state: "failed".into(),
            detail: Some(
                "Provisioning needs root, and sudo cannot ask for a password from here. \
                 Run 'sudo -v' in a terminal once — that unlocks sudo for about fifteen \
                 minutes — then start this again."
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

            // The agent, written beside the script so the server can build it.
            // Without this the script has nothing to deploy and the status
            // panel — the desktop app's main screen — has nothing to talk to.
            let agent_dir = std::env::temp_dir().join("filesynapse-agent");
            std::fs::create_dir_all(&agent_dir)
                .map_err(|e| format!("could not create the agent directory: {e}"))?;
            for (name, contents) in AGENT_FILES {
                std::fs::write(agent_dir.join(name), contents)
                    .map_err(|e| format!("could not write {name}: {e}"))?;
            }

            // Secrets reach the script as environment variables and are never
            // given to `echo` or written by this side. The script itself writes
            // the Backblaze and restic values to a root-owned 0600 file on the
            // server, which is where they belong.
            //
            // `-E` is not decoration. sudo's `env_reset` is on by default, and
            // it rebuilds the environment from scratch — TERM, PATH, HOME, MAIL,
            // SHELL, LOGNAME, USER and SUDO_* — so *every* variable set below
            // was being discarded before the script ever saw it. That meant
            // empty Backblaze credentials, so the script skipped the entire
            // backup block while reporting success, and an empty TRANSFER, so
            // the replace-server routes did nothing. Nothing would have said so.
            //
            // The SETENV tag this needs is implied when the matched command is
            // ALL, which is the ordinary entry for a user in the sudo group. A
            // stricter sudoers makes sudo refuse outright rather than silently
            // dropping the values, which is the failure worth having.
            let mut command = Command::new("sudo");
            command
                .arg("-E")
                .arg("bash")
                .arg(&script_path)
                .env("AGENT_DIR", &agent_dir)
                .env("PHOTOS_DIR", &config.photos_folder)
                .env("FILES_DIR", &config.files_folder)
                .env("TAILSCALE_NAME", &config.tailscale_name)
                .env(
                    "TAILSCALE_TEMP_NAME",
                    config.tailscale_temp_name.clone().unwrap_or_default(),
                )
                .env("TRANSFER", &config.transfer)
                .env("SOURCE_ADDRESS", config.source_address.clone().unwrap_or_default())
                .env("B2_BUCKET", config.b2_bucket.clone().unwrap_or_default())
                .env("B2_KEY_ID", config.b2_key_id.clone().unwrap_or_default())
                .env("B2_APP_KEY", config.b2_app_key.clone().unwrap_or_default())
                .env("RESTIC_PASSWORD", config.restic_password.clone().unwrap_or_default())
                .stdout(Stdio::piped())
                // Captured, not inherited. It used to go to the parent's
                // stderr, which for an app launched from a menu is nowhere —
                // so the likeliest first-run failure of all, sudo refusing
                // because it has no terminal to ask for a password, produced a
                // run that reported "failed" and threw the explanation away.
                .stderr(Stdio::piped());

            let mut child = command.spawn().map_err(|e| format!("could not start: {e}"))?;

            // Drained on its own thread. A pipe nobody reads fills up and
            // blocks the child, and a blocked child here is indistinguishable
            // from a hang — so this cannot be done after `wait`.
            let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
            let stderr_reader = child.stderr.take().map(|stderr| {
                let sink = Arc::clone(&stderr_tail);
                std::thread::spawn(move || {
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        if let Ok(mut tail) = sink.lock() {
                            tail.push(line);
                            // Only the last few: this is a diagnosis, not a
                            // transcript, and the app shows a single line.
                            if tail.len() > 5 {
                                tail.remove(0);
                            }
                        }
                    }
                })
            });

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
            if let Some(reader) = stderr_reader {
                let _ = reader.join();
            }

            if !status.success() {
                let reason = stderr_tail
                    .lock()
                    .ok()
                    .and_then(|tail| tail.iter().rev().find(|l| !l.trim().is_empty()).cloned());

                return Err(match reason {
                    Some(reason) => format!("the provisioning script exited with {status}: {reason}"),
                    None => format!("the provisioning script exited with {status}"),
                });
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

#[cfg(test)]
mod tests {
    use super::parse_line;

    /// The contract between `provision.sh`'s `emit` and the progress list.
    ///
    /// Every line the script prints goes through this, and it is the whole of
    /// what the user watches during a five-minute install. A line it drops is a
    /// step that never appears; a state it misreads is a step that reports the
    /// wrong thing. Neither throws, so neither would be noticed except as a
    /// progress list that looks subtly wrong.
    ///
    /// `emit` writes `printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}"`, so tab-separated
    /// with an always-present third field that may be empty.
    #[test]
    fn reads_a_step_with_a_detail() {
        let event = parse_line("Install Docker\tfailed\tsee the log").expect("should parse");
        assert_eq!(event.step, "Install Docker");
        assert_eq!(event.state, "failed");
        assert_eq!(event.detail.as_deref(), Some("see the log"));
    }

    #[test]
    fn reads_a_step_with_an_empty_detail_as_no_detail() {
        // `emit "$name" start` produces a trailing tab and nothing after it.
        // An empty string here would render as an empty second line under every
        // step that has nothing to say.
        let event = parse_line("Install Docker\tstart\t").expect("should parse");
        assert_eq!(event.state, "start");
        assert_eq!(event.detail, None);
    }

    /// The four states the script actually emits.
    #[test]
    fn accepts_exactly_the_states_the_script_uses() {
        for state in ["start", "ok", "skipped", "failed"] {
            assert!(parse_line(&format!("a\t{state}\t")).is_some(), "{state} should parse");
        }
    }

    #[test]
    fn ignores_a_state_the_script_never_emits() {
        // Anything else is stderr, or output from something the script ran, and
        // must not be drawn as a step.
        assert!(parse_line("a\twarning\tsomething").is_none());
        assert!(parse_line("a\tdone\t").is_none());
    }

    #[test]
    fn ignores_a_line_that_is_not_a_step() {
        assert!(parse_line("just some output").is_none());
        assert!(parse_line("").is_none());
        assert!(parse_line("\t\t").is_none(), "an empty step name is not a step");
    }

    #[test]
    fn keeps_a_detail_that_contains_tabs() {
        // `splitn(3)` rather than `split`, so a detail with tabs in it survives
        // rather than being truncated at the first one.
        let event = parse_line("a\tfailed\tone\ttwo").expect("should parse");
        assert_eq!(event.detail.as_deref(), Some("one\ttwo"));
    }

    #[test]
    fn trims_around_the_fields_but_not_the_state() {
        // The script does not pad, but a stray space should not turn a real
        // step into an unparsed line.
        let event = parse_line("  Backup  \t  ok  \t  done  ").expect("should parse");
        assert_eq!(event.step, "Backup");
        assert_eq!(event.state, "ok");
        assert_eq!(event.detail.as_deref(), Some("done"));
    }
}
