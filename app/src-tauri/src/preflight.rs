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
    // `target` is asked for **last**, and that ordering is the whole of the
    // parsing. It is the only column that can contain a space — `/media/My
    // Drive` — and the two before it are always plain integers. With the mount
    // point in the middle, `split_whitespace` would take its first word as the
    // mount and then fail to read a number where the rest of the name is, so
    // the volume would be dropped: silently missing from the picker, which is
    // the one place it was going to be offered.
    let Some(text) = run(
        "df",
        &["-B1", "--output=avail,size,target", "--local", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs"],
    ) else {
        return Vec::new();
    };

    parse_df(&text)
}

/// The line with its first `n` whitespace-separated fields removed.
///
/// Not `splitn`: splitting on a whitespace *predicate* treats every space as a
/// separator, so the run between two columns yields empty fields rather than
/// being skipped. That version parsed the first number and then failed on ""
/// where the second should have been, dropping every line of every `df`.
fn after_fields(line: &str, n: usize) -> &str {
    let mut rest = line.trim_start();
    for _ in 0..n {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        rest = rest[end..].trim_start();
    }
    rest
}

/// `df` output, as the volumes it describes. Separated from the call so it can
/// be tested without a filesystem.
fn parse_df(text: &str) -> Vec<Volume> {
    text.lines()
        // The header, whatever it says.
        .skip(1)
        .filter_map(|line| {
            // `split_whitespace` collapses runs, which is right for the two
            // numeric columns — and they are guaranteed numeric, which is what
            // makes the mount point safe to find by position afterwards.
            let mut fields = line.split_whitespace();
            let free: u64 = fields.next()?.parse().ok()?;
            let total: u64 = fields.next()?.parse().ok()?;

            let mount = after_fields(line, 2);
            if mount.is_empty() {
                return None;
            }
            Some(Volume {
                mount: mount.to_string(),
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

    // `docker --version` prints the *client* version without contacting the
    // daemon, so Docker installed-and-stopped looks exactly like Docker working.
    // `docker info` is the first command that needs an answer from the daemon,
    // so it is the one that can tell the difference.
    //
    // Checked because it is a real state — a fresh install whose service did not
    // start, or a service someone stopped — and it used to pass preflight, skip
    // provisioning's own `systemctl enable --now docker` (which lives in the
    // "Docker is absent" branch), and then fail at the stack with "Cannot
    // connect to the Docker daemon", which names the wrong step entirely.
    let daemon_running =
        is_linux && run("docker", &["info", "--format", "{{.ServerVersion}}"]).is_some();

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

    if is_linux && docker_version.is_some() && !daemon_running {
        // A warning rather than a blocker: provisioning starts it. Saying so is
        // the point — otherwise this is discovered two steps later, wearing the
        // costume of a stack that will not come up.
        warnings.push(
            "Docker is installed but its daemon is not running. Provisioning will start it."
                .into(),
        );
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

#[cfg(test)]
mod tests {
    use super::parse_df;

    /// What `df -B1 --output=avail,size,target --local` actually prints.
    const REAL: &str = "    Avail        Size Mounted on\n\
                        410234880    500000000 /\n\
                         56789012    123456789 /home\n";

    #[test]
    fn reads_the_volumes() {
        let vols = parse_df(REAL);
        assert_eq!(vols.len(), 2);
        assert_eq!(vols[0].mount, "/");
        assert_eq!(vols[0].free_bytes, 410_234_880);
        assert_eq!(vols[0].total_bytes, 500_000_000);
        assert_eq!(vols[1].mount, "/home");
    }

    #[test]
    fn skips_the_header_rather_than_reading_it_as_a_volume() {
        // The header is "Mounted on" in the last column — in the older column
        // order that is a mount point with a space in it, which is exactly the
        // shape the ordering exists to survive. If this ever parsed, the folder
        // picker would offer a volume called "Mounted".
        assert!(parse_df(REAL).iter().all(|v| v.mount != "Mounted"));
    }

    #[test]
    fn keeps_a_mount_point_that_contains_a_space() {
        // `/media/My Passport` is a real thing somebody plugs into a server.
        // With `target` first, `split_whitespace` took "My" as the mount and
        // then failed to read a number where "Passport" was — so the volume was
        // dropped, and the drive they wanted to store photos on was the one
        // missing from the list.
        let text = "    Avail        Size Mounted on\n\
                    1000000      2000000 /media/My Passport\n";
        let vols = parse_df(text);
        assert_eq!(vols.len(), 1);
        assert_eq!(vols[0].mount, "/media/My Passport");
        assert_eq!(vols[0].free_bytes, 1_000_000);
    }

    #[test]
    fn drops_a_line_it_cannot_read_rather_than_guessing() {
        // A df that printed a warning, or a filesystem whose numbers are "-".
        let text = "    Avail        Size Mounted on\n\
                    garbage line here\n\
                         1234        5678 /ok\n";
        let vols = parse_df(text);
        assert_eq!(vols.len(), 1, "one good line survives, the other is dropped");
        assert_eq!(vols[0].mount, "/ok");
    }

    #[test]
    fn handles_nothing_at_all() {
        assert!(parse_df("").is_empty());
        // A header with no filesystems under it.
        assert!(parse_df("    Avail        Size Mounted on\n").is_empty());
    }

    #[test]
    fn drops_a_line_with_no_mount_after_the_numbers() {
        let text = "    Avail        Size Mounted on\n\
                    1000 2000\n";
        assert!(parse_df(text).is_empty());
    }
}
