# ESPNAS — Build Plan

A self-hosted replacement for **OneDrive** and **Google Photos**, on hardware already owned.

**Scope: personal use first.** Commercialisation is a later phase; see §13 for the small number of decisions that keep that door open.

**A$0 upfront.** Ongoing ~A$110–140/year (cloud backup + electricity), against roughly A$250–350/year of subscriptions.

---

## 1. Final decisions

| Area | Decision |
|---|---|
| Hardware | Old Dell mini PC, ~8 GB RAM, 2× 250 GB SSD |
| OS | Debian 13, headless, Ethernet |
| Storage | 32 GB OS partition + **two role-separated drives: photos, and cloud** |
| Photos backend | **Immich** (stock Docker image) |
| Files backend | **Nextcloud** + MariaDB + Redis (stock Docker images) |
| Remote access | Tailscale — nothing exposed to the internet |
| Backup | `restic` → Backblaze B2, **7-day retention**, no external drive |
| Phones | **Immich app** (upload + gallery) + **Nextcloud app** (files) — both stock |
| Desktop files | **Nextcloud official client** — stock, gives on-demand files free |
| The app | **Your own** — a branded gallery, the actual project |

**No mergerfs.** Storage is two **role-separated** drives rather than one pooled volume — a **photos folder** (Immich's library) and a **cloud storage folder** (Nextcloud's files). This removes the FUSE union layer, a dependency, and a failure mode, and it makes "Set as server" a simple two-picker flow.

The trade: **you can't borrow space between the roles.** Photos can fill their drive while the cloud drive sits half empty. The escape hatch is to add a drive *to the role that filled* — which is the upgrade path already in the plan, and keeps the roles independent. See §5.

### The one thing to understand about this shape

**For pure personal use, you could be fully operational this weekend with zero custom code.** Immich and Nextcloud's own apps already do everything you described — photo upload, gallery, file sync, on-demand files.

So the plan splits cleanly:

- **§4–§10 is infrastructure.** Free, stock, boring. Do it once and your photos are safe.
- **§11 is your project.** The app you want to build. It's the thing that becomes a product later.

**Do the infrastructure first, even though the app is more fun.** Don't leave your photos unprotected for three months while you build a gallery.

---

## 2. Architecture

```
   Phone                  Desktop / Laptop                Mini PC
 ┌────────────┐          ┌──────────────────┐         ┌──────────────┐
 │ Immich app │          │ NC client        │         │  Immich      │
 │  (upload)  │          │  (on-demand      │         │  Nextcloud   │
 │ NC app     │──────────┤   files)         │────────►│  MariaDB     │
 │  (files)   │          │                  │         │  Redis       │
 └────────────┘          ├──────────────────┤         │              │
                         │ Your app         │         │ /srv/photos  │
                         │  (server status) │         │ /srv/cloud   │
                         └──────────────────┘         └──────┬───────┘
                         └──────────────────┘                │
                                              restic ──► B2 ◄─┘
```

**Nothing important lives on your phone or laptop.** Everything lives on the mini PC; the apps are windows onto it. There is one copy, and every device looks at it.

---

## 3. Hardware notes

- **CPU is not the bottleneck.** Thumbnail generation is a one-time batch job — run it overnight.
- **~8 GB RAM** is what allows MariaDB + Redis rather than a SQLite compromise.
- **No UPS.** InnoDB recovers from unclean shutdown via its redo log; ext4 journaling handles the filesystem. The residual risk — a file truncated mid-write — is covered by restic. A small UPS (~A$80–110) is an optional later upgrade.
- **NIC speed doesn't matter.** Even at 10/100, the only affected case is the one-time bulk import. Cloud backup is bounded by your NBN upload. Don't optimise this.
- **Likeliest failure is the PSU/capacitors**, not the drives. That's downtime and a restore, not data loss.

---

## 4. Phase 0 — OS and base prep

Install **Debian 13**, minimal, headless. Plug in Ethernet.

> Check **UEFI vs legacy BIOS** first — it changes the Phase 1 partition layout. Old Dell mini PCs are often legacy.

```bash
# a NAS that sleeps is not a NAS
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

SSH keys only, in `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

---

## 5. Phase 1 — Storage

**Two drives, two roles. No pooling.**

| Disk | Layout | Role |
|---|---|---|
| SSD1 | 512 MB EFI/boot (UEFI only), 32 GB `/`, remainder → `/srv/photos` | **Photos** — Immich's library |
| SSD2 | Whole disk → `/srv/cloud` | **Cloud** — Nextcloud's files |

The 32 GB root is deliberate: a runaway import or log explosion **cannot** fill the volume the OS lives on and stop the machine booting.

```bash
lsblk -f     # get UUIDs
```

`/etc/fstab` — `nofail` so a missing drive can't stop boot:

```
UUID=<ssd1-photos>  /srv/photos  ext4  defaults,nofail,noatime  0 2
UUID=<ssd2-cloud>   /srv/cloud   ext4  defaults,nofail,noatime  0 2
```

```bash
sudo mkdir -p /srv/photos /srv/cloud
sudo mount -a && df -h
```

Expect roughly **218 GB for photos** (SSD1 minus the OS partition) and **250 GB for cloud**.

### Layout — and why the two roles stay separate

```
/srv/photos/     ← Immich owns this entirely
/srv/cloud/
  documents/     ← Nextcloud (the OneDrive replacement)
  projects/      ← Nextcloud
```

**Photos and files never mix.** Two programs managing the same files is how you get silent conflicts, orphaned files and confusing deletions.

> **Trade-off:** you can't browse photos as plain files through the desktop sync folder — they're viewed in the gallery. That matches your model (Files = documents and projects, Gallery = photos). If you later need photos as plain files too, Immich can use an external library or a storage template, but that reintroduces the two-apps-one-folder problem.

### The cost of role separation, and the escape hatch

**You can't borrow space between roles.** Photos can fill their drive while the cloud drive sits half empty, and there's nothing you can do about it without restructuring.

So the split matters. Your data is photos-heavy — if photos reach 200 GB and projects sit at 20 GB, a 50/50 split is fine on your side but would be badly unbalanced on a machine with a different mix. **This is exactly why "Set as server" must let the user pick both folders freely** — including both on one drive for someone who doesn't have two.

**The escape hatch is the upgrade path already in the plan:** when a role fills, add a drive *for that role* rather than rethinking the architecture. The roles stay independent, and you never touch the other one.

**No redundancy.** A drive failure costs that role's files. The cloud backup is what covers you — which is why §9 is not optional.

---

## 6. Phase 2 — Remote access

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale ip -4
```

Install Tailscale on your phone and laptop. **Do this early** — it means you finish everything else over SSH from your desk instead of standing at the machine.

Tailscale gives **one** DNS name per machine, so the cleanest start is ports — no reverse proxy needed:

| Service | URL |
|---|---|
| Immich | `http://espnas:2283` |
| Nextcloud | `http://espnas:8080` |

**Later polish, optional:** your own domain + split DNS + Caddy gives real subdomains and one entry point. Not needed to start.

---

## 7. Phase 3 — The backends

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # log out and back in
```

Run **Immich's official `docker-compose.yml`** for the photo side — don't hand-roll it, it changes often.

Nextcloud, `docker-compose.yml`:

```yaml
services:
  db:
    image: mariadb:11
    restart: unless-stopped
    command: --transaction-isolation=READ-COMMITTED --binlog-format=ROW
    volumes: [./nc-db:/var/lib/mysql]
    environment:
      MYSQL_ROOT_PASSWORD: "__CHANGE_ME_ROOT__"
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      MYSQL_PASSWORD: "__CHANGE_ME_DB__"

  redis:
    image: redis:alpine
    restart: unless-stopped

  app:
    image: nextcloud:apache
    restart: unless-stopped
    ports: ["8080:80"]
    depends_on: [db, redis]
    volumes:
      - ./nc-html:/var/www/html
      - /srv/cloud/documents:/data/documents
      - /srv/cloud/projects:/data/projects
    environment:
      MYSQL_HOST: db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      MYSQL_PASSWORD: "__CHANGE_ME_DB__"
      REDIS_HOST: redis
      NEXTCLOUD_TRUSTED_DOMAINS: "__TAILSCALE_HOSTNAME__"
```

**Three things that will bite you if skipped:**

1. **File ownership.** Nextcloud writes as `www-data` (uid 33):
   ```bash
   sudo chown -R 33:33 /srv/cloud/documents /srv/cloud/projects
   ```
2. **Redis must be registered in Nextcloud**, not just running. In `nc-html/config/config.php`:
   ```php
   'memcache.local'       => '\OC\Memcache\APCu',
   'memcache.distributed' => '\OC\Memcache\Redis',
   'memcache.locking'     => '\OC\Memcache\Redis',
   'redis' => ['host' => 'redis', 'port' => 6379],
   ```
   Without `memcache.locking`, two phones uploading to the same folder throw `file is locked` and stall.
3. **Trash retention = 7 days**, matching the backup:
   ```php
   'trashbin_retention_obligation' => '7, 7',
   ```

**Also set Immich's trash retention explicitly** so both sides behave the same — it has its own setting and the default hasn't been checked.

### De-branding the web UI (the one cheap, legitimate win)

Install Nextcloud's official **Theming app** and set your own product name, logo and colours. This is a supported feature designed for exactly this, and per Nextcloud's trademark policy a white-labelled instance should show **neither their logo nor their wordmark**.

Given the plan uses stock clients, your brand appears in the web UI and nowhere else — so this is the only place worth spending effort on branding right now. It's minutes of work.

**Immich cannot be meaningfully de-branded** — no equivalent theming surface, and the name is baked into the UI. Accept it. It's a personal instance.

**Later, optional:** Nextcloud can be an OIDC provider and Immich supports OIDC, so single sign-on is achievable. Do it after everything works.

---

## 8. Phase 4 — Devices

All stock apps. No custom code in this phase.

- **Android / iOS** — Immich app, enable **Auto upload**. This is the entire reason upload stays with Immich: iOS background upload is the hardest problem in the project and it's already solved there.
- **Android / iOS** — Nextcloud app for browsing documents and projects.
- **Desktop/laptop** — **Nextcloud's official client**, sync `documents/` and `projects/`. On Windows it gives you **Virtual Files** — the folder appears in Explorer, files download on demand. That's the on-demand behaviour you wanted, free.

> **On-demand files come from Nextcloud's stock client.** For personal use there's no reason to fork or rebrand it — that's a branding exercise, and branding only matters when you're shipping to other people. Deferred to §13.

Let the initial sync run overnight. **Verify file counts before trusting it.**

### Uploads never delete your originals

Both apps default to keeping local files. Deleting a photo from your phone does **not** delete it from the mini PC — the server is a backup, not a mirror.

The one exception: **the desktop sync folder is two-way.** Deleting there does delete on the server. That's the only place deletion is real, cushioned by Nextcloud trash (7 days) + restic (7 days).

---

## 9. Phase 5 — Backup

**Do not mirror. Use snapshots.** A sync tool propagates deletions — delete a photo, the mirror deletes it in the cloud minutes later, and now both copies are gone. Same for corruption and ransomware. restic writes versioned, encrypted, deduplicated snapshots.

```bash
sudo apt install restic
sudo restic -r b2:espnas-backup:/ init
```

Credentials in `/etc/restic/env`, mode `600`. `/usr/local/bin/espnas-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/restic/env

restic -r b2:espnas-backup:/ backup /srv/photos /srv/cloud --exclude-caches
restic -r b2:espnas-backup:/ forget --keep-daily 7 --prune
```

Nightly systemd service + timer, `Persistent=true` so a missed run fires on next boot.

**Retention is 7 days by design.** Dedup means unchanged photos are stored once, so the short tail costs nothing in space efficiency.

> **Be deliberate:** 7 days is a recycle bin, not a malware shield. It handles "oops, wrong folder." It does **not** handle corruption or ransomware you don't notice for three weeks. Adding `--keep-monthly 12` costs very little thanks to dedup if you change your mind.

**An untested backup is a guess.** Before cancelling any subscription:

```bash
restic -r b2:espnas-backup:/ snapshots
restic -r b2:espnas-backup:/ restore latest --target /tmp/restore-test
```

---

## 10. Where deletion lives

| Layer | Bin | Retention |
|---|---|---|
| Immich | Immich trash | set explicitly |
| Nextcloud | Trash bin | 7 days |
| Phone | OS recycle bin | platform-dependent |
| Backstop | restic snapshots | 7 days |

The photo bin and the file bin are **separate programs** — when hunting for something deleted, remember which side it was on.

---

## 11. Phase 6 — The app (your project)

This is optional for function and valuable as a project. **Build it after the infrastructure works.**

**Full screen-by-screen specs, with every control and state:**

- **[UI-MOBILE.md](UI-MOBILE.md)** — React Native + Expo. Files-first, contextual search, no uploader.
- **[UI-DESKTOP.md](UI-DESKTOP.md)** — Tauri. Server-first and deliberately lean: a status panel, a tray icon, and the "Set as server" flow. Photos is an optional module; there is no Files browser.

Both are organised as v1 / *later* so they're buildable rather than aspirational.

### What it is

**On mobile**, a branded photo gallery and file browser calling Immich's and Nextcloud's APIs. It is a **viewer, not an uploader** — upload stays with Immich's app, because iOS background upload is the hard problem and it's already solved.

**On desktop**, a lean server monitor: a tray icon, a status panel, and "Set as server". The gallery is an optional module, and there is no file browser — Nextcloud's own client already puts the folder in Explorer with on-demand downloads, so a second one would be duplication. The desktop app answers the question you ask daily; it does not re-implement software you already have.

Justification worth remembering: **Immich's own mobile app is itself an API client.** So a custom client loses nothing — same API, same capabilities, your UI.

### Stack

| Platform | Stack |
|---|---|
| Mobile | React Native + Expo |
| Desktop | Tauri |
| Shared | TypeScript core — API client, auth, thumbnail cache |

**Decision: two separate UI implementations.** React Native draws native mobile components; Tauri renders HTML in a webview. `<View>`/`<Text>` are not `<div>`/`<span>`, so the *screens* are written twice — only the logic layer is shared. Chosen deliberately for genuinely native mobile feel.

The cost is that features and fixes land in two places. Accepted.

*(`react-native-web` was considered as a way to share one component set across both — it would have been roughly 1.3× the work of a single UI rather than 2×, and it avoids Apple's guideline 4.2 rejection of wrapped-website apps. Revisit only if the duplication becomes painful.)*

### Server management — use Cockpit + Portainer, don't build one

There **is** a server management UI. You just don't write it.

**Cockpit** — Linux server admin over the web: system health, storage, systemd services, logs, browser terminal, accounts, updates.

```bash
sudo apt install cockpit
```

Reachable at `https://espnas:9090` over Tailscale.

**Portainer** — Docker/container management: container status, logs, restart, resource use, compose stacks.

```bash
docker run -d -p 9443:9443 --name portainer \
  --restart=unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data portainer/portainer-ce
```

**You need both.** Cockpit's built-in container module is for **Podman**, not Docker — and this stack is Docker Compose. So Cockpit covers the *system*, Portainer covers the *containers*. Together ~100 MB RAM.

**Security:** these listen on ports on the mini PC. Tailscale-only access means they're not reachable from the internet — keep it that way. **Do not port-forward 9090 or 9443.** Cockpit authenticates against Linux accounts; Portainer has its own admin login. Configure both properly before relying on them.

### The desktop app *is* the status panel

Not to replace Cockpit — for the question you'll ask daily:

- Did last night's backup succeed?
- How much disk space is left?
- Are the services up?

Opening a browser, navigating to Cockpit and logging in just to check whether restic ran is daily friction. Three numbers in a tray icon is a much better answer.

| Question | Where |
|---|---|
| "Did my backup run? How full is the disk?" | **Your desktop app** — build this |
| "Why is Nextcloud broken? Show me logs." | **Cockpit** — don't build |
| "Restart the Immich container." | **Portainer** — don't build |
| "The whole box is unreachable." | **SSH** |

That panel is not an addition to the desktop app — it *is* the desktop app. Everything else in it is a tray icon, Settings, and an optional photos module. **Build it first**, ahead of the gallery: it is the smallest piece that is genuinely yours and that nothing else already does.

**Boundary to remember:** your app talks *to* the server. When the server is down you get a timeout, not a diagnosis. Routine visibility lives in your app; real troubleshooting needs SSH or Cockpit.

### The rules that make it fast

- **Central index on the NAS**, but **thumbnail cache on each device** — derived, disposable, rebuildable. If every scroll queried the NAS it would feel terrible over mobile data. This is how Google Photos feels fast.
- **Server-side ML is free via API.** Face grouping, semantic search, video transcoding — all server-side, all exposed. Build none of it.
- **Never resize on request.** Pre-generate thumbnails.

The last rule is about *duplicating* what Immich already does, not about never
running a model. An **optional decision pipeline** — a local vision model that
captions a photo, and a small typed-decision model that scores it — is available
behind a Settings toggle, off by default, served by the host agent rather than a
service of its own. It is a genuine option rather than a duplicate because it
does something Immich does not (rating for a cull queue, suggesting an album),
and because it is off: nothing is scheduled, and an unused pipeline costs
nothing. See `infra/agent/README.md` and for-human.md §8.

### "Set as server" — the install experience as a button

**Designates the current PC as the server, with two selected folders assigned their roles** — a **photos folder** and a **cloud storage folder**. The app then provisions everything: Docker, the compose stack, both mounts, Tailscale, and the backup schedule. Nobody sees a terminal.

This is [§13.1](#13-commercial-foundations--build-these-during-the-personal-phase) made into a feature — the install experience *is* the product, and this is the strongest product idea in the plan. It's what turns "here's a bunch of Docker instructions" into something a customer can actually use.

There is also a **connect-to-existing-server** flow for machines that aren't the host:

- **Test the connection, don't just save a string.** Verify it reaches Immich *and* Nextcloud and that credentials work. Otherwise a typo surfaces as a confusing failure an hour later.
- **Handle unreachable gracefully.** Everything runs over Tailscale, so the server genuinely is unreachable when Tailscale is off. Say *"can't reach your server — is Tailscale connected?"*, don't hang.
- **Credentials in the OS keychain** — Keychain / Credential Manager / libsecret. Never a plaintext config file.

#### Two constraints to resolve

**1. Which platforms can host.** Dropping mergerfs removed the hard Linux-only blocker — there's no Linux-specific filesystem in the design any more. What remains is Docker: Immich and Nextcloud are Linux containers, so the host needs a Linux environment.

| Host | "Set as server" |
|---|---|
| Linux | ✅ Native. Best path by a distance |
| Windows | ⚠️ WSL2 works, but bind mounts across the WSL boundary are fiddly |
| macOS | ⚠️ Docker Desktop runs Linux in a VM; bind-mount permissions and performance are often painful |

So it's a **spectrum rather than a wall** now. But since the app runs on the host (next), hosting from Windows or macOS means installing the app *inside* WSL2 or Docker Desktop's Linux environment — which is exactly the fiddly part. **v1 targets Linux hosts only.** Making the other two work is a real engineering project, not a checkbox, and it is a commercialisation question — deferred to §14.

**2. Where the app runs — resolved: on the host.**

"The host must be able to run the app" is answered by attaching a monitor and keyboard to the mini PC for the one-time setup. Everything then stays local: `lsblk`/`df` for disk checks, native folder pickers, direct access to the Docker socket. There is no SSH layer to build and no remote filesystem to browse, so **"this PC" in the flow is literal** — the machine you are sitting at *is* the machine being designated.

**The cost is a desktop environment.** Minimal Debian has no graphical session, so a monitor alone runs nothing. Phase 0 gains:

```bash
sudo apt install xfce4 xfce4-goodies lightdm
sudo systemctl set-default multi-user.target   # still boots headless
```

Start the graphical session only when the app is needed (`sudo systemctl start lightdm`) rather than at every boot. Tauri's Linux runtime dependencies — webkit2gtk and friends, per Tauri's own docs — come with it.

*(Lighter alternative: `cage`, a kiosk compositor that runs one fullscreen app and nothing else — `cage espnas`. Much less to install, much less familiar.)*

**Deferred — remote provisioning.** Running the app on a laptop and provisioning the server over SSH is still the right answer for a customer whose NAS is a different machine from their laptop. It is not needed for personal use, and it adds remote filesystem browsing, remote preflight and SSH credential handling to the flow. Build it when the product needs it, not before.

**One build, both paths.** The desktop app ships the entire first-run wizard everywhere — both "Set up this computer as your server" and "Connect to an existing server". Finishing the first is what creates the server the second connects to, so a connect-only build could not complete its own first run. Hosting capability is gated at **runtime** by preflight, never removed at build time: on a machine that can't host, Path A is unavailable, not absent.

#### Replacing the server — software only

Moving the server role to a different machine is done **entirely in software**. No drives are physically relocated. This keeps replacement available to anyone whose new machine cannot take the old disks, and it keeps the flow inside the app rather than in the user's hands.

The data crosses the network by one of two routes:

| Route | Good for | Cost |
|---|---|---|
| **Sync from the old server** | Fastest on the same network; copies the current state exactly | Needs the old server up and healthy until the copy finishes |
| **Restore the latest snapshot** | Works even if the old server is already dead | Slower, and loses anything since the last backup — up to a day |

**Credentials survive the move.** Immich API keys live in its database and Nextcloud app passwords in its own, so carrying the data across carries the credentials. Phones and laptops keep authenticating without being re-paired.

**The address is the thing actually being replaced.** Everything downstream points at the Tailscale name, so replacement means making the new machine answer to the same name — nothing else needs reconfiguring. Two machines cannot hold one name, so the order is:

1. Provision the new machine under a **temporary** name
2. Copy the data across
3. **Verify** — file counts, spot-check, run a backup, test a restore
4. Swap the Tailscale name over
5. Decommission the old machine

Step 3 precedes step 4 without exception. Swapping the name early cuts you off from the working server before the replacement is proven — §12's "run both in parallel, then cancel" discipline, pointed at your own hardware.

**What happens to the old machine.** Once the copy is verified and the new server has completed its own backup, the old machine is a spare — and there are two sensible ends for it:

| Option | Effect |
|---|---|
| **Keep it as a second backup target** | It stops serving photos and files and becomes a second restic destination alongside Backblaze. A copy on hardware already owned, costing nothing extra and independent of your internet connection — the strongest option available. |
| **Wipe its photos and files storage** | Frees both drives so the machine can be repurposed or disposed of. |

**The gate is a completed backup, not a completed transfer.** Copying the data leaves two copies, so the old machine *looks* spare while the transfer is fresh — but if the cloud backup is stale or unreachable, the old machine is the only current copy, and wiping it leaves a single copy of everything. The cloud backup's state is therefore read before either option is offered:

- **Backup current** → both routes are offered, and either ending is safe.
- **Backup stale or failed** → "restore from backup" is withdrawn as a transfer route (the old machine may be the only up-to-date source), and the wipe option carries an explicit warning that it would leave one copy until the new server completes its first backup.

Note this changes nothing about §5: the two role-separated drives are still how storage is arranged *within* one server. It only means the drives stay where they are when the server role moves.

**For commercialisation later:** Docker Desktop is free for personal use and small businesses, paid above 250 employees or $10M revenue.

### Build it behind a thin interface

Put a small abstraction layer between your app and the backends — even though Immich is the only one today.

**"Thin" is the operative word.** Six methods, not a provider framework:

```ts
interface PhotoBackend {
  list(opts: { page: number; from?: Date; to?: Date }): Promise<Asset[]>
  get(id: string): Promise<Asset>
  thumbUrl(id: string, size: 'small' | 'large'): string
  search(query: string): Promise<Asset[]>
}

interface FileBackend {
  list(path: string): Promise<Entry[]>
  download(path: string): Promise<ReadableStream>
}
```

That's the whole thing. Writing it costs an hour; skipping it means a rewrite later. This is the single most valuable cheap decision in the section — it's the difference between swapping backends being a one-file change and being a new app.

**Do not build more than this.** No plugin registry, no DI container, no provider discovery. If you write a third backend you'll refactor *then* — the point is only that the refactor stays contained.

**The optional decision pipeline extends `ServerBackend`, and deliberately not
`Backends`.** It is reached through the host agent that already exists, at the
port the client already knows and the capability already allows, so it added no
`DEFAULT_PORTS` entry, no Tauri permission and no credential. A fourth field on
`Backends` would have implied a fourth service, which is the thing that was
rejected: the fan-out is six client surfaces and an uninstall hook that deletes
credentials by name. It is off unless the user asks for it, and off means the
agent is never contacted.

---

## 12. Phase 7 — Migration

**Do not cancel either subscription on the day this works.**

1. **Google Takeout** for Photos — preserves EXIF and albums.
2. **OneDrive** — export, or let the desktop client sync down.
3. Import into `/srv/photos`, let Immich index.
4. **Verify by count and spot-check** — files per year, open random photos.
5. **Test a restore** (§9).
6. Run both systems in parallel **30–60 days**, then cancel.

---

## 13. Commercial foundations — build these during the personal phase

These cost little now and are expensive to retrofit. **The test for each: does it also make your own setup better?** Everything below passes. Anything that only helps a hypothetical future customer does not belong here.

**1. Write your setup as a script, not as typed commands.**

Even though it's just for you. An idempotent `install.sh` plus your compose files plus a `.env.example` means the whole thing is reproducible. For a self-hosted product, the **install experience is the single biggest barrier to adoption** — and you're doing this setup anyway, so capturing it costs you nothing extra. This is the highest-value item on the list.

**2. Nothing hardcoded.**

One env file: server URLs, credentials, ports, paths. No `espnas.local` scattered across thirty files. This is what makes the difference between "my setup" and "something someone else could install."

**3. Separate infrastructure from product.**

```
espnas/
  infra/          ← compose, fstab, install.sh, backup scripts
  app/            ← your client. Depends on nothing in infra/.
```

`app/` should be a standalone thing that happens to talk to a server. If it can't run against a different backend without edits, the boundary has leaked.

**4. Never cross the process boundary — in either direction.**

This is the single rule that keeps your code proprietary, and it cuts both ways:

- **Their code must not come into yours.** No copying, vendoring, or linking Immich or Nextcloud code. Your app calls HTTP APIs — arm's-length communication between two separate programs, which is not a derivative work. That's what makes it proprietary and App Store eligible. **Copying any Immich code into your client destroys that permanently.**
- **Your code must not go into theirs.** Don't add your functions to Immich's source, don't write plugins that run inside its process, don't link a shared library. **Copyleft's trigger is *combination*** — the moment your code and AGPL code form one program, the whole program is AGPL and **your function becomes public too.**

**Arm's-length boundary = safe. In-process = you're inside their program.**

Practically: if you want behaviour Immich doesn't have, put it in your client and call it over the API. Never patch their source. Bonus — this is also the cheapest path, because there's no fork to maintain and no upstream merges to do.

**5. The thin interface (§11).**

Cheap now, a rewrite later.

**6. Own your brand assets from day one.**

Name, icon, colours. Even if only your own app uses them today. Naming things after the fact is a tedious find-and-replace across a codebase; picking a name now is free.

---

## 14. Commercialisation — deferred

**Not doing these now.** Recorded so they aren't stumbled into by default.

- **Forking or rebranding the stock clients.** Unnecessary for personal use — you'd pay the maintenance cost for months before it earned anything.
- **App Store accounts, code signing, notarisation, 3-platform CI.** Real work, zero personal benefit.
- **Multi-user, accounts, billing, licensing/activation.** You are one user.
- **Hosting for other people.** This is the big one — it triggers AGPL's network clause on both servers. Hosting for customers means you must offer them source, and you can never close-source the server. Decide deliberately when you get there.
- **Upstream merge automation.** Only matters once you've forked something.

**Personal use means no distribution, so no copyleft or trademark obligations.** Forking, rebranding, modifying — all fine right now. That changes the moment you ship to another person.

**Known licences, for when it matters:**

| Component | License | Commercial implication |
|---|---|---|
| Immich (server + apps) | AGPL-3.0 | Never fork. Don't ship its code. |
| Nextcloud server | AGPL-3.0 | Can't be closed-source if hosted for others |
| Nextcloud mobile apps | GPLv3 + App Store exception | Forkable, deliberately |
| Nextcloud desktop client | Copyleft | Forking means publishing your fork |
| **rclone** | **MIT** | **Embeddable in a paid proprietary product** |
| **Your own client** | Yours | Fully proprietary — if you keep it clean |

**What you can keep private — the short version:**

| | Private? |
|---|---|
| Your client app, written from scratch | ✅ Yes, entirely |
| Your installer, scripts, compose files, config | ✅ Yes |
| Theming via Nextcloud's Theming app | ✅ Yes — configuration, not modification |
| Your own plugin running *inside* Immich | ⚠️ Grey — depends how tightly it links |
| Your edits to Immich's or Nextcloud's source | ❌ Must publish |
| Your code linked *into* their source | ❌ Must publish |

**Your code, your rules. Their code, their rules.**

**Never modify their source, and you publish nothing — your entire product stays yours.** The obligation only fires when other people use your modified version, and AGPL counts **both** distributing it *and* letting users reach it over a network. Hosting for customers is not a loophole.

The whole strategy follows from that: run the servers **stock**, configure them instead of patching them, and put all your own work in your client, your installer and your scripts. Those are 100% private and sellable.

**Before taking money for anything, get an hour with a software licensing lawyer.** A few hundred dollars against getting this wrong. Ask specifically about AGPL's network clause if you host for customers, and about App Store distribution.

---

## 15. Costs

| Item | AUD |
|---|---|
| Dell mini PC, both SSDs | $0 (owned) |
| Tailscale | $0 (free tier) |
| Backblaze B2 | ~$9/month per TB |
| Electricity (~10–25 W) | ~$26–55/year |
| 1 TB SSD when 468 GB fills | ~$80–120, one-off |
| Optional small UPS | ~$80–110 |

**Ongoing ~A$110–140/year**, against ~A$250–350/year of subscriptions. Pays back inside the first year.

---

## 16. Open items

- [ ] Confirm total RAM (`free -h`) — assumes ~8 GB
- [ ] Confirm UEFI vs legacy BIOS — determines the Phase 1 partition scheme
- [ ] Confirm exact Dell model
- [ ] Decide: Backblaze B2, or restic into an existing paid cloud subscription
- [ ] Set Immich's trash retention to match the 7-day value
- [ ] **Pick a product name** (§13.6) — free now, tedious later

---

## 17. First evening

Phase 0 → Phase 2. Debian on the box, sleep disabled, Tailscale up, **SSH from your phone over mobile data**. Everything after that is incremental and can be done from your desk.

Then work straight through §7–§9 before starting the app. Your photos being safe is worth more than your gallery looking good.
