//! Whether this machine can be the server.
//!
//! PLAN.md §11 makes hosting a *spectrum* rather than a wall: the hard
//! requirement is a Linux environment with Docker, because Immich and Nextcloud
//! are Linux containers. Everything else — root, free space, Compose — is
//! reported so the app can explain itself rather than failing later at a
//! confusing moment.
//!
//! `blockers` means "cannot host at all"; `warnings` means "worth knowing".
//! The app refuses to start provisioning only on the former.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    mount: String,
    free_bytes: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    ok: bool,
    platform: String,
    is_linux: bool,
    has_docker: bool,
    has_compose: bool,
    is_root: bool,
    docker_version: Option<String>,
    compose_version: Option<String>,
    volumes: Vec<Volume>,
    blockers: Vec<String>,
    warnings: Vec<String>,
}

/// Runs a command and returns trimmed stdout, or `None` if it could not run.
fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// `df -B1` gives bytes directly, which avoids re-implementing the unit maths
/// in two places. Only real filesystems are listed — tmpfs and friends would
/// otherwise clutter the folder picker with choices nobody can store photos on.
fn volumes() -> Vec<Volume> {
    let Some(text) = run(
        "df",
        &["-B1", "--output=target,avail,size", "--local", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs"],
    ) else {
        return Vec::new();
    };

    text.lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let mount = parts.next()?.to_string();
            let free: u64 = parts.next()?.parse().ok()?;
            let total: u64 = parts.next()?.parse().ok()?;
            Some(Volume {
                mount,
                free_bytes: free,
                total_bytes: total,
            })
        })
        .collect()
}

#[tauri::command]
pub fn preflight() -> Preflight {
    let platform = std::env::consts::OS.to_string();
    let is_linux = cfg!(target_os = "linux");

    let docker_version = run("docker", &["--version"]);

    // The Compose plugin is a separate install from the Docker engine, and a
    // machine with one and not the other is a common half-configured state.
    let compose_version = run("docker", &["compose", "version"]);

    let is_root = if cfg!(windows) {
        false
    } else {
        run("id", &["-u"]).map(|u| u == "0").unwrap_or(false)
    };

    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    if !is_linux {
        blockers.push(format!(
            "{platform} cannot host: Immich and Nextcloud are Linux containers. \
             Use this machine as a client, or install on Linux."
        ));
    }

    if docker_version.is_none() {
        blockers.push("Docker is not installed.".into());
    }
    if compose_version.is_none() {
        blockers.push("The Docker Compose plugin is not installed.".into());
    }
    if is_linux && !is_root {
        // Not strictly a blocker — provisioning escalates through sudo — but
        // the user needs to expect a password prompt.
        warnings
            .push("Provisioning will need administrator rights to install packages.".into());
    }

    let vols = if is_linux { volumes() } else { Vec::new() };
    if is_linux {
        if let Some(smallest) = vols.iter().filter(|v| v.free_bytes > 0).min_by_key(|v| v.free_bytes)
        {
            if smallest.free_bytes < 20 * 1024 * 1024 * 1024 {
                warnings.push(format!(
                    "{} has only {:.1} GB free.",
                    smallest.mount,
                    smallest.free_bytes as f64 / 1024.0 / 1024.0 / 1024.0
                ));
            }
        }
    }

    Preflight {
        ok: blockers.is_empty(),
        platform,
        is_linux,
        has_docker: docker_version.is_some(),
        has_compose: compose_version.is_some(),
        is_root,
        docker_version,
        compose_version,
        volumes: vols,
        blockers,
        warnings,
    }
}
