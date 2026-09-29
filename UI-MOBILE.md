# ESPNAS — Mobile UI Specification

**Platform:** React Native + Expo (iOS + Android)
**Backends:** Immich (photos) · Nextcloud (files)
**Emphasis:** files-first, with a full gallery
**Companion:** [UI-DESKTOP.md](UI-DESKTOP.md) · [PLAN.md](PLAN.md)

---

## Scope and non-goals

**This app does not upload.** Camera upload is handled entirely by Immich's official app running in the background. This app is a **viewer and browser** — it never touches the camera roll.

This is deliberate and load-bearing: iOS background upload is the hardest problem in the project and is already solved elsewhere. Do not add an uploader.

**v1 = Photos timeline · Albums · Files browser · Settings.** Everything else is marked *later*.

---

## Navigation

**Bottom tab bar, three tabs:**

| Tab | Icon | Purpose |
|---|---|---|
| **Photos** | grid | Gallery |
| **Files** | folder | Document/file browser |
| **Settings** | gear | Server, cache, appearance |

**Search is contextual, not a tab.** A search icon sits in the header of both Photos and Files; tapping it opens a search field scoped to that section. This avoids a fourth tab that's dead weight half the time.

Shared across tabs:

- **Offline banner** (top, persistent while unreachable): *"Can't reach your server — is Tailscale connected?"* with a **Retry** button
- **Pull-to-refresh** on every scrollable surface
- **Toast** for action results ("3 photos deleted", "Download failed")

---

## Screen 1 — First Run: Connect to Server

Shown once, when no server is configured. **Not skippable** — there's nothing to show without a server.

| Element | Behaviour |
|---|---|
| Title | "Connect to your server" |
| Server address field | Single input. Accepts a Tailscale hostname (`espnas`) or full URL. Derives both the Immich and Nextcloud endpoints |
| **Advanced** (collapsed) | Expands to separate Immich and Nextcloud addresses, for anyone running them on different machines |
| **Test connection** / primary button | Validates before saving. See validation states below |
| Help text | "Your server must be reachable over Tailscale" |

**Validation states — report which part failed, never a generic error:**

| Result | Message |
|---|---|
| ✅ Both reachable | Green check, **Continue** enabled |
| ⚠️ Photos reachable, files not | "Connected to photos, but couldn't reach your files — check the Nextcloud address" |
| ⚠️ Files reachable, photos not | Mirror of the above |
| ❌ Nothing reachable | "Couldn't reach your server. Is Tailscale connected on this device?" |
| ❌ Auth failed | "Server found, but the credentials were rejected" |

After a successful test → **Sign in** (credentials) → stored in the OS keychain (Keychain / Credential Manager / libsecret). **Never** a plaintext config file.

**Later:** QR code pairing — the desktop app displays a code, the phone scans it. Removes typing an address entirely.

---

## Screen 2 — Photos

### 2.1 Timeline (default view)

| Element | Detail |
|---|---|
| Layout | Full-bleed grid, 3 columns default |
| Date headers | Sticky, e.g. **Today** · **Yesterday** · **September 2026** · **August 2026** |
| Scroll | Infinite, virtualised, thumbnails load from the on-device cache |
| Grid density | Pinch to change 2 ⇄ 5 columns |
| **Filter chips** (top) | All · Photos · Videos · Favourites |
| **Search icon** (header) | Opens Photos search |
| **Select** (header) | Enters multi-select mode |
| Long-press a tile | Enters multi-select with that item selected |
| Tap a tile | Opens the viewer |

**States:** loading (skeleton grid) · empty ("No photos yet — uploads from your phone appear here") · error (retry) · offline (cached thumbnails still scroll; full images show a placeholder)

**Later:** pinch-to-zoom on the timeline, "Memories"/on-this-day, live photos.

### 2.2 Viewer (full-screen)

| Control | Behaviour |
|---|---|
| Swipe left/right | Previous / next photo |
| Pinch | Zoom |
| Double-tap | Zoom to fit ⇄ 100% |
| Swipe down | Dismiss back to timeline |
| **Top bar** (auto-hides) | Back · filename/date · **Info** · **More** |
| **Bottom bar** (auto-hides) | **Share** · **Download** · **Favourite** · **Delete** |
| Videos | Inline transport controls; playback streamed from the server |
| **Info sheet** | Date taken · location · camera · dimensions · file size · album membership |

Full images are fetched **on demand** — the timeline only ever holds thumbnails.

### 2.3 Multi-select mode

Enters via **Select** in the header or long-press. Selection count shows in the header.

| Action | Behaviour |
|---|---|
| Tap tile | Toggle selection |
| Drag across tiles | Range select |
| **Bottom action bar** | Share · Download · Add to album · Favourite · Delete |
| **Cancel** (header) | Exit selection |
| Delete | Confirmation sheet. Moves to Immich trash — **recoverable for the configured retention period** |

### 2.4 Search

**v1:** filter by date range · photos/videos · favourites.
**Later:** semantic search ("beach", "dog") · people · places — all served by Immich's ML via API, nothing built client-side.

### 2.5 Albums

| Element | Detail |
|---|---|
| List view | Cover thumbnail, name, item count, last modified |
| Open | Grid of that album's items; same viewer and selection behaviour |
| **+ / New album** | Name field → create |
| Album actions | Rename · Add photos · Remove photos · Delete album · Share (later) |
| **Add to album** from selection | Picker listing albums + "New album" |

**Later:** shared albums, collaborative albums, album links.

### 2.6 Favourites

Filtered view of flagged items. Star toggled from the viewer or selection bar.

---

## Screen 3 — Files

### 3.1 Browser

| Element | Detail |
|---|---|
| Layout | List, indented folder tree (mobile-appropriate; no split panes) |
| Breadcrumb | Sticky at top, tappable segments, e.g. `projects › espnas › src` |
| Row | Type icon · name · size · modified date |
| Folders first | Folders sort above files, always |
| **Sort** (header) | Name · Date modified · Size · Type — ascending/descending |
| **View toggle** | List ⇄ grid (grid for image-heavy folders) |
| **Search icon** (header) | Search within files |
| **+ / New folder** | Name field → create |
| Long-press a row | Context sheet: Rename · Move · Delete · Download · Info |
| Tap a folder | Navigate in |
| Tap a file | Preview |

### 3.2 Preview

| File type | Behaviour |
|---|---|
| Images | Full-screen, pinch-zoom |
| PDF | Paged viewer |
| Text / code | Monospace viewer with line wrapping |
| Video | Inline playback |
| Anything else | "No preview — download to open" |

Previews are **generated server-side** by Nextcloud. The phone never decodes a file to display it. *(Requires `ffmpeg` in the container for video thumbnails.)*

### 3.3 File actions

| Action | Detail |
|---|---|
| **Download** | Saves to the device. Marks the file as available offline |
| **Rename** | Inline dialog |
| **Move** | Folder picker |
| **Delete** | Confirmation → Nextcloud trash (recoverable for the retention period) |
| **Info** | Size, type, created, modified, path |

**Later:** offline pinning (explicit "keep on device"), share links, version history.

---

## Screen 4 — Settings

| Section | Items |
|---|---|
| **Server** | Address (read-only display) · **Test connection** · **Disconnect** |
| **Account** | Signed-in identity · **Sign out** |
| **Storage & cache** | Thumbnail cache size · **Clear cache** · list of downloaded files with sizes · **Clear downloads** |
| **Appearance** | Theme: System / Light / Dark |
| **About** | Version · build · open-source licences |

**Cache behaviour:** thumbnails accumulate on demand and are **disposable** — clearing them costs nothing but a re-download. This is the local half of the "central index on the server, thumbnail cache on the device" rule that makes the timeline feel fast over mobile data.

---

## Cross-cutting behaviours

| Behaviour | Requirement |
|---|---|
| **Offline** | Cached thumbnails scroll. Full images and all file operations show "unavailable offline". Never hang, never show a blank gallery without explanation |
| **Tailscale off** | Explicitly detected and named in the message — this is the single most common failure and the message should say so |
| **Deep links** | Tapping a photo notification opens that photo |
| **Background** | No background work. The app does nothing when not open. Upload is Immich's job |
| **Orientation** | Portrait and landscape; grid reflows |
| **Accessibility** | Dynamic type, screen-reader labels on all controls, 44pt minimum touch targets |
| **Pull-to-refresh** | Every scrollable surface |

**Later:** biometric lock · widget (random memory / recent) · share sheet target.

---

## Suggested v1 build order

1. Connect-to-server + keychain storage
2. Photos timeline (read-only) + viewer
3. Thumbnail cache + offline handling
4. Files browser + preview
5. Selection, delete, download
6. Albums
7. Settings

Search returns in v1 only as basic filters; semantic search is *later*.
