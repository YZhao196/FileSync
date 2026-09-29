# For a human

Things that need you, in priority order. Everything not listed here is built —
see [What exists](#what-exists) at the bottom.

The front end is complete and verified in a browser: every control acts on a
real backend (the placeholder one, or live Immich/Nextcloud), including album
contents, search, and every photo and file action. 100 unit tests pass, the
typecheck is clean, and the production build succeeds.

What follows is what a person still has to do, and what has never been run.

---

## 1. Housekeeping before anyone else installs this

**Why this needs you:** these are decisions and accounts, not code.

1. **The product name is FileSynapse.** PLAN.md §16 still lists it as open.
   Settle it or change it before it appears in an installer or a store listing.
2. **Icons are generated** from `filesyn-icon.png` into `app/src-tauri/icons/`.
   Replace the source PNG if the name or mark changes, then re-run:
   ```bash
   cd app && npx tauri icon path/to/logo.png
   ```
3. **The installer is built; signing is the outstanding part.**
   `npx tauri build` produces both Windows bundles:
   - `app/src-tauri/target/release/bundle/msi/FileSynapse_0.1.0_x64_en-US.msi` — 7.3 MB
   - `app/src-tauri/target/release/bundle/nsis/FileSynapse_0.1.0_x64-setup.exe` — 5.5 MB

   **What it does.** Per-user install with no administrator prompt, and a Start
   Menu entry — per-user deliberately, because the credentials live in the
   per-user keychain and the login item is per-user, so a machine-wide install
   would not match. The WebView2 bootstrapper is **embedded**, so satisfying the
   one prerequisite does not need internet access. And **uninstall cleans up
   after itself**: `app/src-tauri/installer/hooks.nsh` deletes the four
   credentials from Windows Credential Manager and the launch-at-login registry
   value. Those outlive the files, and one of them is a secret.

   **What it does not do.** It is **unsigned**, so SmartScreen and Gatekeeper
   warn on install. Windows needs a code-signing certificate; macOS needs a
   Developer ID and notarisation. There is no auto-update, worth deciding on
   deliberately rather than by inheriting it.

   **Run one install/uninstall cycle by hand.** The hook is verified as far as a
   machine can verify it — the credential names and registry value were read out
   of keyring 3.6.3's and auto-launch's sources rather than guessed, the
   generated NSIS script includes the hooks file and calls the macro at the top
   of its Uninstall section, and the commands themselves were tested. What has
   not happened is the cycle end to end on a real machine.
4. **Set the version** in three places that must agree:
   `app/package.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`.
   `Settings → About` reads the version from the running binary, so it cannot
   disagree with the one you shipped.
5. **Approve the npm install scripts, once.** `@tauri-apps/cli` was added as a
   dev dependency this session (it is what generates icons and runs
   `tauri dev`). npm 11 flags an unapproved postinstall in its dependency tree:
   ```bash
   cd app && npm approve-scripts --allow-scripts-pending
   ```
   Everything works without it today; a clean `npm ci` on a new machine may not.

---

## 2. Check the desktop app by hand

**Why this needs you:** it is running, but the parts that matter now are the ones
that need eyes and a mouse.

The Rust toolchain is installed and the shell is **built and launched**: the
icons exist, `cargo build` links with zero warnings, and `npx tauri dev` starts
the window and stays up — which means the tray icon was created and no plugin
failed to initialise.

The **release** profile builds as well: `npx tauri build` completes in about
14 minutes, and the packaged `filesynapse.exe` (16 MB) starts cleanly from
`app/src-tauri/target/release/` with nothing written to stdout or stderr. That
is what confirms it is a working desktop application rather than a web page in a
frame — but it is a *startup* check, not an interactive one.

What has *not* been confirmed is anything interactive, because that needs a
person at the window:

```bash
cd app && npx tauri dev
```

- The window has a native title bar (the app draws no chrome of its own).
- **The tray icon is present.** Its tooltip says just `FileSynapse` until the app
  is in live mode and the watcher has polled once, after which it carries the
  backup state — that is the point of the tray, so it is worth seeing it change.
- **Settings → Desktop** shows working Launch at login and Tray icon switches.
  Those two rows only appear inside the shell; they read "Needs the desktop app"
  in a browser.
- **Pick a folder** through any Browse… button — a real OS dialog, not the
  browser's `prompt()` fallback.
- **Download** a photo or file — a real Save dialog, and the file lands where
  you put it.
- Quit from the tray menu, and confirm the process actually exits.

The tray has only ever been compiled and started on Windows. macOS and Linux
tray behaviour (menu on left click, icon theming) is untested.

---

## 3. Deploy the host agent

**Why this needs you:** it is written, but it has to run on the server, and there
is no server yet.

Without it the Status panel — the app's primary screen — has no data in live
mode. Immich and Nextcloud expose nothing about restic, disk usage or container
health.

```bash
cd infra/agent
cp .env.example .env          # set AGENT_TOKEN — openssl rand -hex 32
docker compose up -d
curl -H "Authorization: Bearer $AGENT_TOKEN" http://localhost:8787/api/status
```

Full contract and configuration: [`infra/agent/README.md`](infra/agent/README.md).

One honest caveat in that file: `nextRunAt` is derived as last-run-plus-24h
rather than read from the systemd timer, which keeps the agent off any one init
system.

`lastRunOk` is a **fact where the provisioning script has run**, because the
agent reads the timer's own verdict file (`AGENT_BACKUP_STATUS`, written by §5)
on every status call and prefers it. It is only **inferred** — a snapshot inside
36 hours taken as evidence the run worked — on a server built by hand, where
that file does not exist. restic's repository keeps no exit status, so without
the file a run that failed after writing nothing is indistinguishable from one
that never started.

**Do not port-forward 8787.** Tailscale only, like everything else here.

---

## 4. Build the server itself

PLAN.md §4–§9: Debian, the two role-separated drives, Tailscale, Immich,
Nextcloud, restic → Backblaze. §5 below will do this for you, but it has never
been run. Until a server exists, the app has no live data to show.

---

## 5. Provisioning has never been run

**Why this needs you:** it needs a Linux machine to run on, and it installs
packages.

This is the flagship feature — "Set up this computer as your server" — and it is
now **written end to end**: the app checks the machine, collects the folders and
backup credentials, and runs a real script.

| Piece | Where | State |
|---|---|---|
| Preflight (OS, Docker, Compose, free space) | `app/src-tauri/src/preflight.rs` | Compiles; verified in a browser, where it correctly refuses |
| Provisioning screen | `app/src/screens/Provision.tsx` | Verified in a browser as far as it can go |
| The script | [`infra/provision/provision.sh`](infra/provision/provision.sh) | `bash -n` clean. **Never executed** |

**Treat the first run as a test, on a machine you can rebuild.**

```bash
sudo PHOTOS_DIR=/srv/photos FILES_DIR=/srv/files \
     TAILSCALE_NAME=filesynapse \
     ./infra/provision/provision.sh
```

It installs Docker, writes `docker-compose.yml` and `.env` to `/opt/filesynapse`,
creates both folders, joins Tailscale, and installs a nightly restic→Backblaze
timer. Output is one `step<TAB>state<TAB>detail` line per event, which is what
the app's progress list parses.

Things to check on that first run, because nobody has:

- **Immich is pointed at MariaDB, which it does not support.** `provision.sh`
  writes one stack in which `immich-server` connects to the shared `mariadb:11`
  as `DB_USERNAME: postgres` to a database `immich` that the script never
  creates. Immich requires PostgreSQL — this is not a tuning problem, it is the
  wrong database. PLAN.md §7 says to run Immich's own compose for the photo side;
  the script hand-rolled one instead. **Immich will not start as written**, and
  it needs fixing before the first run rather than discovered during it.
- The same stack shares a single Redis between Immich and Nextcloud. Both use it,
  for different things — Nextcloud for file locking, Immich for job queues — and
  neither expects to share a keyspace. Two stacks give each its own.

- The Compose stack actually starts and Immich and Nextcloud come up healthy.
  The script starts them and moves on; it does not wait for health.
- `nextcloud:apache` with `- ${FILES_DIR}:/var/www/html/data` assumes the data
  directory is empty. On a reused folder it will not adopt existing files.
- The restic unit writes `/var/lib/filesynapse/last-backup` with an `ok`/`failed`
  line, and the host agent reads it on every status call, so `lastRunOk` is a
  fact rather than an inference — but only if the agent's `AGENT_BACKUP_STATUS`
  points at that path, and only if the agent's `/var/lib/filesynapse` mount can
  see it. Both are already configured; the thing never checked is that they
  agree.
- The install it does not cover: `restic` and `rsync` are installed conditionally,
  and the `restore` route assumes a repository already exists at
  `b2:$B2_BUCKET:/filesynapse`.

**Replacing an existing server now runs the same script.** The replace flow
collects its own folders and a transfer route, then calls the provisioning runner
with `TRANSFER=sync|restore` and `SOURCE_ADDRESS`, and streams the same progress
as §5. It provisions under a temporary Tailscale name (`<old-server>-new`) so the
working server keeps answering, and the name only moves on the handover step.

It has never been run either — treat it exactly as §5 describes, and note that the
`sync` route is the one that depends on the old server staying up for the whole
copy.

---

## 6. Immich API key needs "all" permissions

Not a bug here — a gotcha to know before you conclude the client is broken.

Since Immich **v1.136.0**, routes without a declared scope implicitly require the
`all` permission, and there is no narrower permission for reading metadata. A
scoped key returns **403 Forbidden** from `/api/search/metadata`. Grant the key
**all** permissions.

Also confirmed while checking: Immich authenticates with the **`x-api-key`
header**. `Authorization: Bearer` returns 401, and there is **no `apiKey` query
parameter** — which is why thumbnails are fetched as bytes and turned into object
URLs rather than being a plain `<img src>`.

---

## 7. The live clients are unverified, and now there is more of them

**Why this needs you:** they need a real server to check against.

The placeholder backend is fully exercised by tests and by hand, so the *UI* is
known to work. What is guessed is the wire format of the live calls. The list has
grown this session — the actions that used to be "not wired" are now real
requests, and every one of them is a guess:

| Call | Guessed | Risk |
|---|---|---|
| `POST /api/search/metadata` `{page, size}` | the timeline | the response envelope `assets.items` |
| `POST /api/search/smart` `{query}` | search | same envelope |
| `GET /api/albums` | album list | bare array vs a wrapper |
| `GET /api/albums/{id}` `{assets}` | album contents | |
| `PUT /api/assets/{id}` `{isFavorite}` | favourite toggle | Immich changed this endpoint's shape across versions |
| `DELETE /api/assets` `{ids, force:false}` | delete to trash | body shape |
| `PUT /api/albums/{id}/assets` `{ids}` | add to album | asset ids vs a `{ids}` wrapper |
| `POST /api/shared-links` | share | `{type, assetIds}` and the `key` → URL shape |
| `GET /api/assets/{id}/original` | download | should be fine |
| WebDAV `MKCOL`, `MOVE`, `DELETE` | new folder, rename, delete | `Destination` must be absolute; `Overwrite: F` refuses a collision |
| WebDAV `PROPFIND` XML | file listing | already parsed and tested; the *server's* dialect is not |

`describeConnection` in `core/client.ts` is the safety net: it names which of the
three endpoints failed rather than reporting "the server is down".

**Where to start:** open the app in live mode, press Test connection, then open
Photos. A 403 there is the §6 permission, not a code bug.

---

## 8. Turn on the decision pipeline (optional, off by default)

**Why this needs you:** it installs two model containers, and it wants RAM this
machine may not have.

Everything here is optional and nothing runs until you switch it on in
**Settings → Decision pipeline**. The server does no background work: it captions
only when a screen asks, so an enabled pipeline nobody is using costs nothing.

Once on, two things appear in the timeline. **Score** rates the photos it can
see, and a **Needs review** chip lists them weakest first — the queue orders a
human's review and never deletes anything. **Add to album** gains a **Suggested**
row, which you still have to tap; nothing is ever filed automatically.

```bash
cd infra/agent
docker compose --profile decisions up -d
docker compose exec ollama ollama pull moondream
```

Then set `AGENT_IMMICH_URL` and `AGENT_IMMICH_API_KEY` in `.env` — the same
all-scoped Immich key from §6. Immich lives in the other compose stack, so there
is no service name this one can assume; see `.env.example` for the two usual
answers.

**Be honest about the hardware.** This is an 8 GB box already running Immich's own
ML container. `moondream` adds roughly 2 GB of RAM while loaded and may push it
into swap. Scoring is sequential on purpose — one photo at a time — and a whole
library is a day-scale batch, not a button. Score the newest photos, not
everything. The review chip ranks whatever the timeline has loaded, so scroll
further if the queue looks short.

**What it will not do.** The caption is the vision model's description of what is
in the frame, not a judgement of how good the photograph is. The scoring model can
catch blur, darkness and framing; it cannot rank two good holiday photos. The
queue is "likely rejects, weakest first".

**`UNVERIFIED:` the scoring half has no confirmed home yet.** Laya, the
open-weight decision model this was built for, is weeks old and none of its
documented distribution routes states a supported container entrypoint.
`infra/agent/docker-compose.yml` carries a comment naming the two candidates and
`infra/agent/README.md` explains the seam. Until it is resolved the cull queue
still works from captions alone and the album suggestion simply does not appear —
which is why the vision half is not blocked on the unresolved half.

**Cost when off:** zero. No port, no container, no request. The four
`/api/decisions` routes answer `unavailable` and the app hides every surface that
would need them.

---

## 9. Not built

| Feature | Notes |
|---|---|
| **Mobile app** | The design prototype covers mobile; only desktop is built. A separate React Native codebase (PLAN.md §11) |
| **Code signing, notarisation, installer, auto-update** | See §1 |
| **People, Places, a map** | Deliberately removed. Immich's own web UI already groups faces and shows locations, so the app was duplicating software you already run. The screens, their nav entries, the `/api/people` and EXIF-place calls, and their tests all came out — the photo section is Timeline and Albums, and nothing is left half-wired. Bringing them back means rewriting them |
| **Albums: create, delete, cover images** | Viewing and adding to albums works. Creating one is Immich's job. Covers are server gradients, not the first photo |
| **Upload** | Deliberate, and now a hand-off rather than a dead button: "Upload in Nextcloud" opens the current folder in Nextcloud's own web UI. Background sync and resume are the hard parts and they are solved there |
| **Restore from trash** | Deleting moves items to the server's trash; restoring is done in Immich. The confirm dialog says so |
| **Multi-select download** | One file at a time. Several would mean several save dialogs, which is worse than saying no |
| **PDF / office previews** | Images and text render inline; anything else gets its metadata and a Download button rather than a broken frame |
| **QR pairing** | First Run mentions it as "later" |
| **Automatic album filing** | The pipeline *suggests* an album inside the add-to-album dialog; it never files without a tap. Filing on its own needs a watcher, cannot be reviewed before it acts, and a mis-filed photo is silent corruption of your own organisation |
| **Cull the whole library** | The timeline pages 100 at a time, and the review chip ranks what is loaded. Scoring is sequential on the server, so a whole library is a long batch. Incremental by design — see §8 |
| **Caption freshness for edited photos** | Captions are keyed by Immich asset id and survive an in-place edit of the photo. "Clear captions" in Settings is the manual reset |
| **The privacy gate** | The pipeline can score and route, but it does not gate what reaches the cloud backup |

---

## Divergences from the markdown specs

The designs in `FileSync Frontend Designs.html` are newer than the specs, and the
designs were followed.

1. **Product name is FileSynapse**, not ESPNAS. PLAN.md §16 still lists the name
   as open.
2. **The Files browser exists** — as a module offering *in-app browser* or *open
   in system explorer*. UI-DESKTOP.md says Files is cut entirely. It now supports
   preview, download, new folder, rename and delete.
3. **Photos is likewise a choice** — in-app viewer, or hand the folder to the OS.
4. **Nothing physical moves when replacing a server** — recorded in PLAN.md §11.
5. **People, Places and a map are not built** — removed on request, because
   Immich's own UI already covers them. See §9.
6. **The photo identity is the server's own id**, a string, not a number. The
   first draft hashed Immich's UUID to an int, which made favouriting,
   downloading and deleting impossible — a hash cannot be turned back into an id.

---

## What exists

| Thing | State |
|---|---|
| `app/` — React + TypeScript + Vite frontend | Built, typechecks strict, production build passes |
| 100 unit tests | Passing across 7 files, plus 11 checks on the caption store |
| Timeline paging | Pages 100 at a time, loading as you scroll, and says when it has reached the end |
| All screens | First Run, Provision, Server, Photos (Timeline / Albums / album contents), Files, Settings, Replace server |
| Photo actions | Favourite, share, add to album, download, delete — single and in bulk |
| File actions | Preview, download, new folder, rename, delete |
| Search | ⌘K / Ctrl+K over photos (server-side) and files (by name) |
| Tauri shell | Built and launched; tray, autostart, notifications, keychain, CORS-free HTTP and the provisioning runner all wired. Interactive behaviour unconfirmed — see §2 |
| A host agent | Written and its HTTP contract tested. Not deployed — see §3 |
| An optional decision pipeline | Written and verified in a browser against the placeholder backend: the cull queue and the album suggestion both work, and both vanish when it is off. Never run against real models — see §8 |
| A provisioning script | Written, `bash -n` clean, never executed — see §5 |
| The replace-server flow | Runs that same script with `TRANSFER` and `SOURCE_ADDRESS` and streams its progress. Verified in a browser as far as it can go, where it correctly refuses and says why. Never run for real — see §5 |
| Live Immich / Nextcloud clients | Written, unverified — see §7 |

Run it in a browser:

```bash
cd app && npm install && npm run dev
```

Run it as a desktop app:

```bash
cd app && npx tauri dev
```

Test it:

```bash
cd app && npm test
```
