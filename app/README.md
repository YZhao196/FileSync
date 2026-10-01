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
toolchain; see [`filesynapsetodo.md`](../../../filesynapsetodo.md).

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

## Design system

The UI is **BuildNexus**: Carbon v11 tokens, Primer React 38.40 components, IBM
Plex type, Carbon icons.

```
src/styles/tokens.css               Carbon tokens, vendored from the design system
src/styles/buildnexus.css           Primer plus the remap onto those tokens
src/styles/buildnexus-overrides.css Our patches for gaps in that remap
src/styles/fonts.css                IBM Plex @font-face (files in public/fonts)
src/styles/base.css                 Application base — reset, selection, toast
```

`buildnexus.css` ends with a block that points Primer's own variables at the
Carbon tokens, which is what makes a stock Primer component come out in the
BuildNexus palette. Do not remove it.

`buildnexus-overrides.css` fills the gaps it leaves. Two so far, and both fail
**silently** rather than loudly:

- **Disabled button fills are not remapped.** Without the patch a disabled
  primary button renders Primer's own green — reading as a working button that
  ignores you — instead of Carbon's neutral disabled grey.
- **The motion tokens do not resolve.** BuildNexus defines
  `--motion-duration-micro`, `--motion-transition-enter` and friends as aliases
  of Carbon's `--base-duration-*` / `--base-easing-*`, and those base tokens
  were never vendored — so every alias resolved to nothing, and
  `animation: fadeIn var(--motion-transition-enter)` is an invalid declaration
  the browser drops without a word. The overrides file supplies the base values,
  which is what the vendored aliases expect to find.

It is a separate file so the vendored stylesheet stays byte-identical to the
design system and can be re-copied without losing either fix.

Motion goes through those tokens, never a literal duration, so tuning the design
system tunes the app. The two animated things are the screen entrance and photo
tiles arriving; both are disabled wholesale under `prefers-reduced-motion` by the
rule at the end of `base.css`.

`base.css` is no longer a component stylesheet. Every screen builds from Primer,
so `.btn`, `.card`, `.group`, `.seg` and friends are gone; what remains is the
page itself. In particular it deliberately has **no `outline: none` on focus** —
BuildNexus requires a visible ring on every interactive element and Primer draws
it, so a reset there would silently remove the keyboard affordance.

Icons come from `components/Icon.tsx`, a name-based facade over
`@carbon/icons-react` — `<Icon name="folder" size={16} />`. Sizes snap to
Carbon's 16/20/24/32, since the design system says not to scale icons.
`carbonIcon('folder')` returns the component itself, for APIs that take an icon
(`Card.Icon`, a Button's `leadingVisual`).

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

Three things that are load-bearing rather than incidental:

- **`react-is` is a direct dependency pinned to the React 18 line, on purpose.**
  `@primer/react` declares it as a *peer* with the range `18.x || 19.x`, so npm
  installs the highest match — 19 — while this app runs React 18. Primer's
  `Button` branches on `isElement` from that package to decide between rendering
  a visual and calling it as a component, and react-is 19 looks for React 19's
  element symbol. The result was that any plain element passed as a
  `leadingVisual`/`trailingVisual` — the sidebar's `<kbd>Ctrl+K</kbd>` — was
  treated as a component and took the whole app down. Do not remove it without
  moving to React 19.
- **`src/core/mock.ts` is a real, mutable backend**, not canned responses — and
  it is a development-only test double. Favouriting, deleting, renaming and
  creating a folder all change its state and persist for the session. That is
  what makes "the front end works" a checkable claim without a server.
- **`src/native/bridge.ts` imports no npm package.** The Tauri shell injects its
  own globals; importing `@tauri-apps/api` would stop the browser build from
  starting, which is the one thing that file exists to prevent.
