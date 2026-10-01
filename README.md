# FileSynapse

A self-hosted replacement for OneDrive and Google Photos, on hardware you already
own.

The desktop client watches a server from the tray — did the backup run, how full
is the disk, are the services up — and browses its photo and file libraries. It
is a **viewer, not an uploader**: camera upload stays with Immich's own app, and
file sync with Nextcloud's.

```
app/                React + TypeScript + Vite desktop client (Tauri shell)
mobile/             React Native + Expo client (Android; iOS needs a Mac)
infra/agent/        the host agent behind the status panel
infra/provision/    provisioning script, embedded into the binary
scripts/            the checks that keep the two clients in step
```

## Status

**Not yet functional end to end.** The client has never reached a real server,
and no server has been built. Everything that runs today runs against a
development mock.

| | |
|---|---|
| Desktop client | Built — 151 tests, strict typecheck, production build; screens walked in a browser against the mock |
| Tauri shell | Builds on Windows, Linux and macOS, all three green in CI; **nothing has been published**, because [`release.yml`](.github/workflows/release.yml) needs a `v*` tag and none has been pushed |
| Mobile client | All four screens built, and all four run under test; **never run on a device** |
| Host agent | Written, its HTTP contract tested; **not deployed** |
| Provisioning | Written, dry-run against a sandbox; **never run on a machine** |
| Live Immich / Nextcloud clients | Written, **unverified**, on both clients |

The two clients share their logic by copy, not by link: `scripts/sync-core.mjs`
writes `mobile/src/core` and `mobile/src/lib` from `app/src`, and CI fails when
they drift. See [mobile/README.md](mobile/README.md).

**Nothing has ever reached a live server**, and no server has been built. Every
bundle is **unsigned** — see [app/README.md](app/README.md) for what each
platform warns about. iOS is not built and cannot be without a Mac.

[`filesynapsetodo.md`](../../filesynapsetodo.md) lists what is left, in priority
order. It lives **outside this repository** — in `Side Projects/`, two levels up
from here — deliberately, so it survives a fresh clone. Links to it from inside
the repo are relative paths out of the tree.

## Installing it

**Downloads are on the [Releases page](https://github.com/YZhao196/FileSync/releases).**
Every tagged release carries installers for Windows, Linux, macOS and Android.
They are unsigned — each platform warns about that, and
[`.github/release-notes.md`](.github/release-notes.md) says what each warning
looks like.

**That page is empty today.** No `v*` tag has been pushed, so nothing has been
published and nothing below has been downloaded by anyone. Until then, build it
from source — see [Building it from source](#building-it-from-source).

**The server comes first.** Every client is a viewer with nothing to show until
one exists, so a client installed first lands on a connection screen that cannot
succeed.

### 1. The server — Linux, one button

Immich and Nextcloud are Linux containers, so the server is a Linux machine: one
Debian 12 or Ubuntu 22.04 box. The preflight accepts those two and refuses
anything else by name.

1. Download `FileSynapse_*_amd64.AppImage` (or the `.deb`) from
   [Releases](https://github.com/YZhao196/FileSync/releases).
2. Run it **on the machine that will be the server**.
3. Click **Set up this computer as your server** and follow the wizard.

That is the whole install. The wizard checks the machine, takes the two folders,
asks for an off-site backup target, and then downloads and installs everything
else — Docker, Tailscale, Immich and Nextcloud with their own databases, the
nightly restic snapshot, and the host agent — reporting each step as it runs. It
is five steps rather than one because which disks the libraries live on, and
whether there is an off-site copy, are worth deciding before a five-minute
install rather than after it.

**It needs a desktop session**, because it is a window with a button in it. On a
headless machine the same provisioning runs from a shell, below.

> **Never run.** The button has been dry-run against a sandbox with every
> external command stubbed, which proves what it generates and cannot prove that
> apt, Docker or systemd do anything with it. Nobody has clicked it on a real
> machine yet.

**On a headless box**, or from a checkout:

```bash
sudo bash infra/provision/smoke.sh
```

It stubs the tailnet by default, because joining a real one adds a machine called
`filesynapse` to your network as a side effect of a test — set
`SMOKE_REAL_TAILSCALE=1` to join for real.

Afterwards, and whenever something looks wrong:

```bash
sudo bash infra/provision/verify.sh
```

Read-only, safe on a machine in use. One check worth knowing about: Nextcloud can
be up and answering while refusing every request that arrives by the tailnet's own
name, which looks like a broken install and is a setting. Nothing else in the
project can see that.

**Run it on a machine you are willing to lose.** It installs packages and starts
services; a throwaway VM is the right shape for a first attempt.

### 2. Windows and macOS — clients only

Download and run the installer. Both are **clients**: they connect to the
server, and the "set up this computer" button is not in them, because Immich and
Nextcloud cannot run on either.

| | |
|---|---|
| Windows | `FileSynapse_*_x64-setup.exe` — per-user, no administrator prompt. Its uninstall removes the stored credentials and the login item |
| macOS | `FileSynapse_*_aarch64.dmg` — Apple silicon. Intel Macs are not built |

**Unsigned.** Windows: SmartScreen warns — *More info* → *Run anyway*. macOS:
Gatekeeper refuses outright — right-click → *Open*, then *Open* again.

macOS keeps its stored credentials in the Keychain and Linux in libsecret, and
both survive deleting the app — remove the `filesynapse` entries by hand.
Windows is the tidy one: its uninstall removes them.

### 3. Android

Download `filesynapse-*-android.apk` from Releases and install it, or sideload it
with `adb install`. It is **unsigned**, so Android warns — *Install anyway*.

**The one thing a device is needed for:** the whole backend is plain `http://`
over the tailnet, and Android blocks cleartext by default. It is configured, and
if that configuration is wrong *every request fails* — which no amount of mock
testing shows. The bundle and all four screens run under test; it has never run
on a device.

### 4. iOS

**Not buildable, and that is hardware rather than a missing step.** An unsigned
iOS build is Simulator-only and the Simulator needs macOS; installing on a phone
additionally needs an Apple Developer membership.

Use Immich's and Nextcloud's own apps on an iPhone. That is the intended answer
rather than a workaround — camera upload is Immich's job, and iOS background
upload is the hardest problem in this project.

### 5. Pointing the clients at the server

Every device — desktop, phone, laptop — needs **Tailscale**, signed into the same
tailnet as the server. Nothing is exposed to the internet and there is no port
forwarding; the tailnet is the whole of the connectivity.

Then in the app: **First Run** takes the server's tailnet name (e.g.
`filesynapse`) and three credentials. One name is enough — the three endpoints
are derived from it. Press **Test connection**, which probes a route requiring
Immich's `AlbumRead` and a Nextcloud PROPFIND and reports *which* half failed.

| Credential | Where it comes from |
|---|---|
| Immich API key | Immich → Account Settings → API Keys. Needs the **`all`** permission |
| Nextcloud username | The admin account you created on first sign-in |
| Nextcloud app password | Personal settings → Security → *Create new app password*. **Not** your login password |
| Host agent token | On the server: `sudo cat /opt/filesynapse/agent/.env` |

Provisioning generates that last one and deliberately does not print it, because
the provisioning log is world-readable.

## Building it from source

```bash
cd app && npx tauri build
```

One command per platform, producing every format that platform has — `bundle.targets`
is `all`, so Windows gives NSIS and MSI, Linux gives deb, rpm and AppImage, and
macOS gives app and dmg.

| Platform | Where it can be built |
|---|---|
| Windows | Anywhere with the Rust toolchain |
| Linux | On the machine it will run on. Needs `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `patchelf`, `libssl-dev`, `libsecret-1-dev` |
| macOS | **Only on macOS.** A macOS binary cannot be produced anywhere else |

Android, from `mobile/`:

```bash
npm install
npx expo prebuild -p android --no-install
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`.

**Pushing a `v*` tag does all of the above.** [`release.yml`](.github/workflows/release.yml)
builds the three desktops and the APK on GitHub's runners and attaches them to the
release, which is how the downloads at the top of this file are produced. The tag
must match the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, and
the workflow refuses to publish if they disagree.

## Running it

```bash
cd app
npm install
npm run dev        # http://127.0.0.1:5173 — mock data, no server needed
npm test
npm run typecheck
npm run build
```

A development build runs against a mock backend so every screen works with no
server anywhere. **A shipped build never does** — `core/client.ts` selects the
mock only when `import.meta.env.DEV`, which is statically false in production.

As a desktop app:

```bash
cd app && npx tauri dev     # or: npx tauri build
```

Requires the Rust toolchain. The installer is per-user (no administrator
prompt), embeds the WebView2 bootstrapper, and its uninstall removes the stored
credentials and the login item.

## Design

The client uses **BuildNexus** — Carbon v11 tokens, Primer React components, IBM
Plex type, Carbon icons. The tokens and Primer stylesheet are vendored in
`app/src/styles/`; IBM Plex is self-hosted so the app stays offline-capable.
Every screen builds from those Primer components, so there are no app token
aliases left to learn — use the Carbon names (`--layer-01`, `--text-primary`)
directly. `app/README.md` covers the four stylesheets and what each is for.

## Reading order, if you are new

1. [`PLAN.md`](PLAN.md) — every decision and the reason behind it. Start here.
2. [`filesynapsetodo.md`](../../filesynapsetodo.md) — what still needs a person
   (`Side Projects/`, outside the repo).
3. [`UI-DESKTOP.md`](UI-DESKTOP.md) — screen specs. Older than the designs where
   they disagree.
4. [`app/README.md`](app/README.md) — running and testing the client.

`FileSync Frontend Designs.html` is the visual source of truth.

## Licence

Not yet decided. See PLAN.md §13–§14 for why the architecture is arm's-length:
the servers run **stock** and are configured rather than patched, and all of this
project's own code lives in the client, the installer and the scripts.
