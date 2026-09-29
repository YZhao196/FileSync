# Provisioning

Turns a fresh Debian or Ubuntu machine into the FileSynapse server, in one run.

This is what the desktop app's **"Set up this computer as your server"** button
executes. It is also runnable by hand, which is how it should be tested first.

> **Never executed.** The script has been syntax-checked (`bash -n`) and nothing
> more — no machine has run it. Treat the first run as a test, on a machine you
> can rebuild. See [for-human.md](../../for-human.md) §5.

## Run it

From the app: **First Run → Set up this computer → …**, which runs the same
script after checking the machine can host.

By hand:

```bash
sudo PHOTOS_DIR=/srv/photos \
     FILES_DIR=/srv/cloud \
     TAILSCALE_NAME=filesynapse \
     ./provision.sh
```

## What it does

| Step | Result |
|---|---|
| Preflight | Refuses on non-Debian, non-root, or identical folders |
| Packages | Docker CE + Compose plugin, curl, jq, openssl |
| Folders | `$PHOTOS_DIR` and `$FILES_DIR`, roles kept separate |
| Stacks | Writes **two** under `/opt/filesynapse`: `immich/` (Immich's own compose, fetched from their release assets, plus a generated `.env`) and `nextcloud/` (written by this script, with its own MariaDB and Redis). Each gets a 0600 `.env` and its own generated database password. Then `docker compose up -d` in both. |
| Tailscale | Installs if absent, joins the tailnet as `$TAILSCALE_NAME` |
| Backup | restic to Backblaze B2, nightly systemd timer, verdict file |
| Transfer | Optional: `rsync` from an old server, or restore the latest snapshot |

Services started: Immich (`:2283`), Nextcloud (`:8080`), MariaDB, Redis.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PHOTOS_DIR` | `/srv/photos` | Immich's library |
| `FILES_DIR` | `/srv/cloud` | Nextcloud's data — the second drive, per PLAN.md §5 |
| `TAILSCALE_NAME` | `filesynapse` | The name everything else reaches this box by |
| `TAILSCALE_TEMP_NAME` | — | Join under a temporary name while replacing another server |
| `TZ_NAME` | `UTC` | Passed to Immich |
| `STACK_DIR` | `/opt/filesynapse` | Where the compose stack is written |
| `BACKUP_HOUR` | `3` | Hour of the nightly run |
| `B2_BUCKET`, `B2_KEY_ID`, `B2_APP_KEY`, `RESTIC_PASSWORD` | — | All four together enable backup; omit them and the step is skipped |
| `TRANSFER` | `fresh` | `fresh`, `sync`, or `restore` |
| `SOURCE_ADDRESS` | — | Old server, required by `sync` |

## Output protocol

One tab-separated line per event, which is what the app's progress list parses:

```
step<TAB>start|ok|skipped|failed<TAB>detail
```

Everything else goes to stderr. Full output is also appended to
`/var/log/filesynapse-provision.log`.

## Two things it deliberately does not do

- **Wait for health.** It starts the stack and moves on. Whether Immich and
  Nextcloud actually came up is the app's Status panel job, not this script's.
- **Roll back.** A failure stops the run and names the step. Nothing is undone,
  because undoing half an install is more dangerous than leaving a machine you
  can inspect.

## The backup verdict file

The timer writes `/var/lib/filesynapse/last-backup`:

```
ok 2026-09-25T03:14:00+10:00
```

The host agent reads it, which turns `lastRunOk` from an inference into a fact.
See [the agent's README](../agent/README.md#where-lastrunok-comes-from).
