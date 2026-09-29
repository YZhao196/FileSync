# Host agent

The status panel's data source. Immich and Nextcloud expose nothing about restic,
disk usage or container health, so the desktop app asks this instead.

Runs as a container so the host needs nothing installed.

```bash
cp .env.example .env     # set AGENT_TOKEN — openssl rand -hex 32
docker compose up -d
curl -H "Authorization: Bearer $AGENT_TOKEN" http://localhost:8787/api/status
```

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ ok: true }` — unauthenticated, for container health checks |
| GET | `/api/status` | the `ServerStatus` shape in [`app/src/core/types.ts`](../../app/src/core/types.ts) |
| POST | `/api/backup` | `202` — starts restic in the background |
| POST | `/api/services/:name/restart` | `202` — restarts the container matching `:name` |

Auth is `Authorization: Bearer <AGENT_TOKEN>`. With no token set the API is open —
that is for local development only, and the agent warns on startup.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PORT` | `8787` | Matches what the app derives |
| `AGENT_TOKEN` | — | **Set this.** Shared secret |
| `AGENT_PHOTOS_PATH` | `/srv/photos` | Photos drive, used for `df` and backup |
| `AGENT_CLOUD_PATH` | `/srv/cloud` | Cloud drive |
| `AGENT_SERVICES` | `immich,nextcloud,mariadb,redis` | Containers to report on |
| `RESTIC_REPOSITORY` | `b2:espnas-backup:/` | Where backups go |
| `AGENT_BACKUP_STATUS` | `/var/lib/filesynapse/last-backup` | The timer's own verdict file, if present |

## Design notes

Every collector degrades independently — a missing `docker`, `restic` or
`/proc` yields an empty value rather than failing the endpoint. A panel reading
"unknown" is useful; a 500 is not. It also means the agent runs on a laptop,
which is how its contract is tested.

### Where `lastRunOk` comes from

restic's repository keeps no exit status, so by default `lastRunOk` is
**inferred**: a snapshot inside 36 hours is taken as evidence the last run
worked. That cannot tell a run that failed after writing nothing from one that
never started.

If the backup timer writes a verdict file, the agent reads it and `lastRunOk`
becomes a **fact** instead:

```
ok 2026-09-25T03:14:00+10:00
```

[`infra/provision/provision.sh`](../provision/provision.sh) installs a timer that
does exactly this. A server built by hand can too — one line, written by the same
script that runs restic:

```bash
printf 'ok %s\n' "$(date -Is)" > /var/lib/filesynapse/last-backup
```

The file is read on every `/api/status` call, so no restart is needed. Anything
that cannot be parsed is ignored and the inference applies, which is why a
half-written file cannot report a false success.

`nextRunAt` remains derived — last run plus 24 hours — rather than read from the
systemd timer, which would tie the agent to one init system. The app applies its
own staleness window on top, so a timer that stops running altogether still gets
flagged.
