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
| Desktop client | Built — 146 tests, strict typecheck, production build; screens walked in a browser against the mock |
| Tauri shell | Compiles and launches on Windows; **Linux and macOS bundles have never been built** |
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

**The server comes first.** Every client is a viewer with nothing to show until
one exists, so a client installed first lands on a connection screen that cannot
succeed.

**Nothing below has been run end to end against a live server**, and each section
says which half is which. The distinction is the useful part: the desktop client's
screens have been exercised against a mock, and the server-side steps have been
read and dry-run but never executed on a machine.

### 1. The server

One Debian 12 or Ubuntu 22.04 machine. The preflight accepts those two and
refuses anything else by name.

```bash
sudo bash infra/provision/smoke.sh
```

That is the whole install. It installs packages, starts Docker, fetches Immich's
compose from its own release assets, brings up Immich and Nextcloud with their
own databases, joins the tailnet, writes the nightly restic backup, builds the
host agent, and then runs `verify.sh` against the result — reporting whether the
server *works* rather than whether its steps exited zero.

**Run it on a machine you are willing to lose.** It installs packages and starts
services; a throwaway VM is the right shape for a first attempt. The tailnet is
stubbed by default, because joining a real one adds a machine called
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

> **Never run.** `provision.sh`, `verify.sh` and `smoke.sh` have been dry-run
> against a sandbox with every external command stubbed, which proves what they
> generate and cannot prove that apt, Docker or systemd do anything with it.

### 2. Windows, Linux and macOS

| Platform | Build | Produces |
|---|---|---|
| Windows | `cd app && npx tauri build` | NSIS setup (6.2 MB) and MSI (8.1 MB) |
| Linux | the same, on the machine it will run on | deb, rpm, AppImage |
| macOS | the same, **on a Mac or a `macos-latest` runner** | app, dmg |

Needs the Rust toolchain, and Tauri's system libraries on Linux
(`webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `patchelf`,
`libssl-dev`, `libsecret-1-dev`).

**Every bundle is unsigned.** Windows: SmartScreen warns — *More info* → *Run
anyway*. macOS: Gatekeeper refuses outright — right-click → *Open*, then *Open*
again. Linux: nothing blocks it.

| | |
|---|---|
| Windows | **Built.** No install/uninstall cycle has been run by hand |
| Linux and macOS | **Never built anywhere.** macOS binaries cannot be built off macOS |

Uninstall removes the stored credentials on Windows. On Linux and macOS they
live in libsecret and the Keychain and survive deleting the app — remove the
`filesynapse` entries by hand.

### 3. Android

```bash
cd mobile
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`; install it with
`adb install` on a device with USB debugging on. It is **unsigned**, so Android
warns — *Install anyway*. CI builds the same APK and attaches it to the run.

| | |
|---|---|
| Bundles, and all four screens | **Verified** under test |
| Installed and run on a device | **Not verified.** No device here, and no Android SDK |

**The one thing a device is needed for:** the whole backend is plain `http://`
over the tailnet, and Android blocks cleartext by default. It is configured, and
if that configuration is wrong *every request fails* — which no amount of mock
testing shows.

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
