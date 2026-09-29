# ESPNAS — Desktop UI Specification

**Platform:** Tauri (Windows · macOS · Linux)
**Backends:** Immich (photos) · Nextcloud (files)
**Emphasis:** server-first. Photos is an optional module.
**Companion:** [UI-MOBILE.md](UI-MOBILE.md) · [PLAN.md](PLAN.md)

---

## Scope and non-goals

**This app does not upload**, and it is **not** the file-sync client. On-demand files in Explorer/Finder come from Nextcloud's official client, unmodified.

**The app is lean by design.** Its default state is a tray icon and a server status panel — the questions you actually ask daily: *did the backup run, is the disk filling up, are the services up.* Everything else is opt-in.

| | |
|---|---|
| **Baseline** | Server status · Settings · tray icon. This is the whole app |
| **Optional module** | **Photos** — a gallery, switched on in Settings |
| **Not built** | A **Files browser** — see below |

**Why there is no Files browser.** Nextcloud's official client already puts the folder in Explorer/Finder with on-demand downloads, and Nextcloud's own web UI covers everything else. A second file browser built in this app is duplication of software you already have installed, and the earlier draft of this spec said so itself. It is deliberately absent, not deferred.

It is the only place your brand appears on the desktop. Everything else is stock software doing invisible work in the background.

---

## Navigation

**Left sidebar, collapsible.** The Photos section appears only when the module is enabled — with it off, the sidebar is two items and there is no search field (search belongs to Photos).

```
┌────────────────────────────────────────────────────┐
│  [🔍 Search…]  ← photos module only         [ ⌘K ]  │
├──────────┬─────────────────────────────────────────┤
│ SERVER   │                                         │
│ Status ● │                                         │
│──────────│                                         │
│ PHOTOS   │            main content area            │
│ Timeline │                                         │
│ Favourites│                                        │
│ Albums   │                                         │
│ People   │                                         │
│ Places   │                                         │
│──────────│                                         │
│ Settings │                                         │
└──────────┴─────────────────────────────────────────┘
```

| Sidebar item | Purpose | Present when |
|---|---|---|
| **Status** | Server health — see §2 | Always |
| **Settings** | Configuration | Always |
| **Timeline** | Main photo grid | Photos module on |
| **Favourites** | Starred items | Photos module on |
| **Albums** | Album management | Photos module on |
| **People** | Face groups | Photos module on *(later)* |
| **Places** | Map view | Photos module on *(later)* |

A **status dot** next to Server shows at a glance: green (healthy) · amber (warning, e.g. backup failed) · red (a service is down).

---

## Screen 1 — First Run

A wizard with **two paths**, presented as two large cards. This is the first thing every user sees, and [PLAN.md §13.1](PLAN.md) treats it as the product.

**One build, both paths.** Every install ships the whole wizard. This is not just packaging convenience: finishing Path A is what *creates* the server that Path B then connects to, so a connect-only build could not complete its own first run. The paths are sequential, not alternatives.

Path A is present everywhere and gated at **runtime** by the preflight in §2.2 — enabled on a Linux host, shown-but-unavailable elsewhere. Never dropped from the build.

### Path A — "Set up this computer as your server" *(Linux)*

Designates **this PC** as the server. Full flow in §2.2. It is not a dead end: on completion it proceeds straight into Path B, connecting this same app to the server it just provisioned.

### Path B — "Connect to an existing server"

For machines that aren't the host — and for phones' desktop counterparts. Also the second half of Path A, with the address and credentials filled in.

| Element | Behaviour |
|---|---|
| Server address | Single input; derives Immich + Nextcloud endpoints |
| **Advanced** (collapsed) | Separate addresses per backend |
| **Test connection** | Validates; reports *which* part failed (see the error table in [UI-MOBILE.md §1](UI-MOBILE.md)) |
| Credentials | Stored in the **OS keychain** — Keychain / Credential Manager / libsecret. Never a plaintext file |

Both paths end at the same place: a working connection, and the app opens on **Status**.

### The Photos module is asked for, not assumed

After the connection succeeds, the wizard offers Photos **once** — a single *"Show photos on the desktop too?"* with Yes/No — then never asks again.

Declining is the expected answer for someone who came for the server panel: they keep a two-item sidebar, and the app is complete. The choice is reversible in Settings at any time.

---

## Screen 2 — Server

**The main screen.** In a lean app this is not a feature alongside others — it is the app. Its tabular state is also what the tray icon summarises.

### 2.1 Status panel

| Card | Contents |
|---|---|
| **Services** | Immich ● · Nextcloud ● · MariaDB ● · Redis ● — each up/down/starting, with **Restart** |
| **Storage** | Two bars: **Photos** drive (used/total) · **Cloud** drive (used/total). Turns amber at 85%, red at 95% |
| **Backup** | Last run (time + ✅/❌) · Next scheduled · Snapshot count · Total size in the cloud |
| **Network** | Tailscale: connected/disconnected · device name · tailnet IP |
| **Uptime** | Server uptime · last boot |

**Actions:**

| Button | Behaviour |
|---|---|
| **Back up now** | Triggers restic immediately; shows progress |
| **Open logs** | Opens Cockpit in the browser (see [PLAN.md §11](PLAN.md)) |
| **Containers** | Opens Portainer |
| **Restart service** | Per-service restart with confirmation |

Read-only when the app is connected to a **remote** server you don't administer — the panel then shows only what's publicly reportable.

### 2.2 "Set as server" flow

The flagship. Turns **this PC** into the NAS — and it means *this* PC literally. The app is installed on the host it is provisioning, so preflight and folder picking are local: no SSH, no remote filesystem. **Linux hosts only in v1**; on Windows and macOS the flow is hidden, not failed.

**Step 1 — Preflight.** The app checks and reports, rather than failing halfway:

| Check | Failure behaviour |
|---|---|
| Linux host | A precondition, not a check — v1 supports Linux only, since Immich and Nextcloud are Linux containers |
| Docker installed & running | Offer to install, or link to instructions |
| Free disk space | Warn if either target folder has < 50 GB |
| Two folders on **different physical disks** | **Warn, don't block** — same-disk works but loses the point of role separation |
| Tailscale installed & authenticated | Offer to install |

Because the app runs on the host, every check is local — `lsblk`/`df` for disks, the local Docker socket for containers.

**Step 2 — Choose folders.** Two pickers, clearly labelled:

- **Photos folder** — "Where your photos will live. Immich will manage this folder."
- **Cloud storage folder** — "Where your documents and project files will live."

Each shows the chosen path, the containing disk, and free space. A warning appears inline if both resolve to the same physical device.

**Step 3 — Provision.** A progress list, each step live, with a scrolling log below:

```
✅ Checking Docker
✅ Creating photos folder at /srv/photos
✅ Creating cloud folder at /srv/cloud
✅ Writing mount configuration
⬳ Starting Immich…
⬳ Starting Nextcloud…
   Starting database…
   Starting cache…
⬳ Configuring Tailscale
⬳ Scheduling nightly backup
```

**Step 4 — Done.** Shows the Server status panel, now populated. Offers **Connect this app** — which runs Path B's flow prefilled with the local address, closing the loop back into Screen 1 — and a **QR code** to pair a phone without typing an address.

**Failure handling:** every step is idempotent and re-runnable. If step 5 fails, **Retry** resumes there rather than starting over.

---

## Screen 3 — Photos *(optional module)*

**Not part of the baseline app.** Everything below appears only after the module is switched on in Settings (§4), or accepted during first run.

### 3.1 Timeline

| Element | Detail |
|---|---|
| Layout | Justified grid, responsive to window width |
| Date headers | Sticky section headers: **Today** · **Yesterday** · **September 2026** |
| Scroll | Virtualised, infinite. Thumbnails from the local cache |
| **Grid size** | Slider or `Ctrl/Cmd + -` / `+`. Small → large, ~6 zoom levels |
| **Group by** | Day · Month · Year |
| **Filter chips** | All · Photos · Videos · Favourites |
| **Search field** | Top bar, `⌘K` / `Ctrl+K` |
| Hover a tile | Quick actions fade in: ★ favourite · ⋯ menu |
| Click a tile | Opens the viewer |
| Drag across tiles | Marquee / rubber-band selection |
| Click + Shift | Range select |
| Click + `⌘`/`Ctrl` | Add to selection |

**States:** skeleton grid while loading · empty state ("No photos yet") · error with retry · offline (cached thumbnails scroll, full images show a placeholder).

### 3.2 Viewer

Opens full-window, dimmed background.

| Control | Behaviour |
|---|---|
| `←` / `→` | Previous / next |
| `Esc` | Close |
| `Space` | Toggle info panel |
| Scroll wheel | Zoom |
| `+` / `-` | Zoom in / out |
| `0` | Fit to window |
| Drag | Pan when zoomed |
| **Top bar** (auto-hides) | Filename · date · **Info** · **More** |
| **Bottom bar** (auto-hides) | Share · Download · Favourite · Add to album · Delete |
| Videos | Transport controls, streamed from the server |

### 3.3 Info panel (right, toggled)

EXIF and metadata: date taken · camera · lens · aperture/shutter/ISO · dimensions · file size · GPS · album membership · original filename.

**Later:** "Show on map".

### 3.4 Selection mode

Enters on marquee, shift-click, `⌘`/`Ctrl`+click, or `⌘A` / `Ctrl+A` for all.

A **bottom selection bar** appears: *"12 selected"* with **Share · Download · Add to album · Favourite · Delete · Clear selection**.

### 3.5 Albums · 3.6 People · 3.7 Places

- **Albums** — grid of album covers; create, rename, add/remove items, delete. Drag photos onto an album in the sidebar to add.
- **People / Places** — *later*, served by Immich's ML via API. Nothing built client-side.

### 3.8 Search

**v1:** date range · type · favourites · filename.
**Later:** semantic ("beach", "dog"), people, places — all server-side.

---

## Screen 4 — Settings

| Section | Items |
|---|---|
| **Server** | Address · **Test connection** · **Disconnect** · (if host) **Set as server** |
| **Modules** | **Photos section**: on / off. Turning it off hides the sidebar section and stops thumbnail caching |
| **Account** | Signed-in identity · **Sign out** |
| **Appearance** | Theme: System / Light / Dark · Grid density · Sidebar: expanded/collapsed default |
| **Storage** | Thumbnail cache location + size + **Clear** *(photos module only)* |
| **Startup** | **Launch at login** · **Start minimised to tray** |
| **Notifications** | Backup completed · Backup failed · Service down |
| **Advanced** | Server log level · Open config folder · Export diagnostics |
| **About** | Version · build · licences |

**Turning Photos off** removes the section, the search field, the thumbnail cache and the deep-link handler. It does not touch the server — nothing is deleted, and turning it back on re-downloads thumbnails.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘,` / `Ctrl+,` | Settings |
| `⌘1` / `Ctrl+1` | Server status |
| `⌘2` / `Ctrl+2` | Settings — or **Photos**, when the module is on |
| `⌘K` / `Ctrl+K` | Search *(photos module)* |
| `←` `→` | Previous / next photo *(viewer)* |
| `Esc` | Close viewer · clear selection |
| `Space` | Toggle info panel |
| `+` / `-` | Grid size, or zoom in viewer |
| `0` | Fit to window |
| `⌘A` / `Ctrl+A` | Select all |
| `Delete` / `Backspace` | Delete selection |

---

## System integration

| Feature | Detail |
|---|---|
| **Tray / menu bar icon** | Always present — and in a lean app it is the **main surface**, not a shortcut to the window. Right-click: Open · Server status · Back up now · Quit |
| **Tray tooltip** | "ESPNAS — healthy · backup 4h ago" |
| **Native notifications** | Backup completed · **Backup failed** · Service down. The backup failure notification is the whole reason the app runs at all — it's the one thing that must work when nobody is looking |
| **Launch at login** | Off by default; prompted after first successful setup |
| **Single instance** | Second launch focuses the existing window |
| **File associations** | Optional: "Open with ESPNAS" for image types *(photos module)* |
| **Deep links** | `espnas://photo/<id>` *(photos module)* |

---

## Cross-cutting behaviours

| Behaviour | Requirement |
|---|---|
| **Offline** | Cached thumbnails scroll *(photos module)*. The status panel shows "unreachable" rather than stale data |
| **Server unreachable** | Explicit: *"Can't reach your server — is Tailscale connected?"* with **Retry** |
| **Thumbnail cache** | Disposable and rebuildable. Clearing costs only a re-download. Exists only when the photos module is on |
| **Never resize on request** | All thumbnails pre-generated server-side |
| **Accessibility** | Full keyboard navigation, visible focus rings, screen-reader labels, respects OS reduced-motion |
| **Multi-window** | *Later* — a separate window for Photos |

---

## Suggested v1 build order

**The baseline app first.** It is complete and shippable at step 5, before any gallery exists.

1. Connect-to-server + keychain (Screen 1, Path B)
2. Server status panel — the baseline app in full
3. Tray icon + backup-failure notification
4. Settings, including the Photos module toggle
5. **"Set as server"** — last of the baseline, because it depends on everything above being stable
6. **Photos module** — optional, and genuinely deferrable

Build "Set as server" last but design for it from the start: it's the feature that makes this a product rather than a personal tool, and it's the one a customer meets first.

**Step 6 can wait indefinitely.** The app is not incomplete without it — that is the point of the module. Nothing in steps 1–5 should reference photos except the toggle that turns them on.
