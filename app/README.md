# FileSynapse — desktop client

Server-first desktop app: a status panel, a tray surface, and optional Photos and
Files modules. Built from `FileSync Frontend Designs.html`.

Depends on nothing outside this directory (PLAN.md §13.3).

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # vitest
npm run typecheck
npm run build
```

## Two ways to run it

**In a browser** — `npm run dev`. Development builds run against a mock backend,
so every screen works with no server anywhere; the OS-dependent parts (folder
dialogs, open-in-explorer, the tray, notifications, provisioning) degrade to a
documented fallback and say so.

**A shipped build never uses that mock.** `core/client.ts` selects it only when
`import.meta.env.DEV`, which is statically `false` in production — so an
installed app always talks to a real server, and there is no switch, setting or
code path by which a user sees fabricated data.

**As a desktop app** — `npx tauri dev`, or `npx tauri build` for installers.
This is the real thing: CORS-free HTTP, the OS keychain, the tray,
launch-at-login, notifications, and the provisioning runner. Requires the Rust
toolchain; see [../for-human.md](../for-human.md).

## Installer

`npx tauri build` produces an NSIS setup and an MSI in
`src-tauri/target/release/bundle/`.

- **Per-user install** — no administrator prompt. Correct here rather than
  merely convenient: credentials live in the per-user keychain and the login item
  is per-user, so a machine-wide install would not match.
- **WebView2 bootstrapper is embedded**, so the installer does not need internet
  access to satisfy the one prerequisite.
- **Uninstall cleans up after itself** — `src-tauri/installer/hooks.nsh` removes
  the four credentials from Windows Credential Manager and the launch-at-login
  registry value. Those outlive the files, and one of them is a secret.

The bundles are **unsigned**, so SmartScreen warns on first run.

Append `?platform=macos`, `?platform=windows` or `?platform=linux` to the URL to
override OS detection — useful for checking how keyboard shortcuts and
file-manager names render on a machine you don't have. See `src/lib/platform.ts`.

## Layout

```
src/
  core/          domain types, the thin backend interfaces, mock + live clients
  state/         app state, persisted settings
  components/    shared primitives (sidebar, dialogs, search palette, tiles)
  screens/       one directory per screen
  hooks/         useAsync, useThumb, useBackupWatch
  native/        bridge to the OS, with browser fallbacks
  lib/           pure helpers: formatting, paths, photo grouping, backup state
```

`src/core/backends.ts` is the whole backend surface — `PhotoBackend`,
`FileBackend`, `ServerBackend`. Keep it thin; it exists so swapping a backend is
a one-file change, not a rewrite.

Two rules worth keeping:

- **`src/core/mock.ts` is a real, mutable backend**, not canned responses — and
  it is a development-only test double. Favouriting, deleting, renaming and
  creating a folder all change its state and persist for the session. That is
  what makes "the front end works" a checkable claim without a server.
- **`src/native/bridge.ts` imports no npm package.** The Tauri shell injects its
  own globals; importing `@tauri-apps/api` would stop the browser build from
  starting, which is the one thing that file exists to prevent.
