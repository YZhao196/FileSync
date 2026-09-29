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
| GET | `/api/decisions/status` | the `DecisionStatus` shape — see below |
| POST | `/api/decisions/score` | `{ ids }` → `{ ok, scores, pending, failed }` |
| POST | `/api/decisions/albums` | `{ ids, albums }` → `{ ok, suggestions }` |
| POST | `/api/decisions/cache/clear` | `{ cleared }` |

Auth is `Authorization: Bearer <AGENT_TOKEN>`. With no token set the API is open —
that is for local development only, and the agent warns on startup.

The four `/api/decisions` routes belong to the optional pipeline and answer
`200 { ok: false, reason }` when it is unavailable, rather than failing. That is
deliberate, and mirrors the collectors: the caller can say something specific.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PORT` | `8787` | Matches what the app derives |
| `AGENT_TOKEN` | — | **Set this.** Shared secret |
| `AGENT_PHOTOS_PATH` | `/srv/photos` | Photos drive, used for `df` and backup |
| `AGENT_CLOUD_PATH` | `/srv/cloud` | Cloud drive |
| `AGENT_SERVICES` | `immich=immich_server,nextcloud=nextcloud,mariadb=nextcloud-db,postgres=immich_postgres` | Containers to report on, as `slug` or `slug=container` |
| `RESTIC_REPOSITORY` | `b2:filesynapse-backup:/` | Where backups go |
| `AGENT_BACKUP_STATUS` | `/var/lib/filesynapse/last-backup` | The timer's own verdict file, if present |
| `AGENT_OLLAMA_URL` | `http://ollama:11434` | Vision model. Unset disables the pipeline |
| `AGENT_LAYLA_URL` | `http://layla:8080` | Decision model. Unset disables the scoring half |
| `AGENT_IMMICH_URL` | — | **Must be set** for the pipeline; Immich is in the other stack |
| `AGENT_IMMICH_API_KEY` | — | The app's all-scoped Immich key (for-human.md §6) |
| `AGENT_VISION_MODEL` | `moondream` | Ollama model tag |
| `AGENT_DECISION_BATCH` | `8` | Photos per request — a patience setting, not a limit |
| `AGENT_CAPTION_PATH` | `/var/lib/filesynapse/decisions/captions.json` | Caption cache |
| `AGENT_MEMORY` | `512m` | Container memory cap |
| `OLLAMA_MEMORY` | `3g` | Vision model's cap — raise it if the model refuses to load |
| `LAYLA_MEMORY` | `4g` | Decision model's cap |
| `LAYLA_CHECKPOINT` | `convaiinnovations/laya-multilingual` | Not the English one — see `layla/` |

Both containers are capped, and both have healthchecks. The caps exist because
this machine also runs Immich's own ML container: an uncapped model does not fail
loudly, it pushes the box into swap and takes the stack with it. A cap set too low
refuses the load instead, which you can see. `docker compose ps` reports health,
so "running" and "ready" are no longer the same claim.

## The decision pipeline (optional)

Off unless configured. A photo is downloaded from Immich, described in one
sentence by a vision model, and the description is answered by a small typed
decision model — a `score` for the cull queue, a `choice` over the user's album
names for routing.

The app is the only thing that asks. There is **no scheduler and no watcher
here**: nothing is captioned until a screen requests it, so an enabled pipeline
that nobody is using costs nothing. The client drives the backlog by calling
`score` repeatedly while `pending > 0`, which is why there is no job object and
no endpoint to poll — a second source of truth for "what is left" is a thing to
get out of sync.

Captions are cached on disk; the decision model re-runs every time. The vision
model is the slow, memory-hungry half and the 421M classifier is not, so caching
the caption is the whole win. A change of `AGENT_VISION_MODEL` invalidates every
entry rather than serving one model's text as another's.

### Running the models

```bash
docker compose --profile decisions up -d      # starts ollama and builds layla
docker compose exec ollama ollama pull moondream
```

`layla` is built locally from [`layla/`](layla/) rather than pulled, because it
is a thin wrapper we own. Its first build is slow — torch is large — and the
first request is slower still, since the checkpoint downloads then. Give it a
few minutes before concluding it is broken.

`ollama` is behind a profile so a plain `docker compose up -d` does not pull
gigabytes of model onto a machine that has to survive Immich indexing first.

**Laya, the decision model, is a service under `layla/`.** `UNVERIFIED:` it has
never been built or run. `server.py` is deliberately a pass-through over Laya's
own `predict` — `POST /decide` takes its two arguments and returns its `answers`,
so there is no translation layer to get wrong and nothing to keep in step when
the model's API moves. The Dockerfile installs `laya` from PyPI and pins torch to
the CPU wheels, since this box has no GPU.

It publishes no port; only the agent reaches it, over the compose network.

Two things are genuinely uncertain, and both are marked in the code. First,
whether `pip install laya` and `laya.load(...)` work as documented in a container
at all. Second, whether a `score` answer is the criteria list's index or an
already-normalised value — `normalizeScore` in `decisions.mjs` assumes the index
and returns `null` for anything outside the scale, so getting it wrong shows up
as photos failing to score rather than as a queue of confident nonsense.

If either is wrong, the change is confined to `layla/server.py` and
`normalizeScore`. Until it is sorted, the cull queue still works from captions
alone and the album suggestion simply does not appear.

### Hardware honesty

This box already runs Immich's own ML container. `moondream` adds roughly 2 GB
of RSS while loaded and may push an 8 GB machine into swap, which is why
captioning is **sequential** — one photo at a time, no parallelism knob — and
why a whole-library scan is a day-scale batch rather than a button. Scoring is
for the newest photos, not for everything.

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
