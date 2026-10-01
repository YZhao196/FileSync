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
| Desktop client, screens, tests | Built — 108 tests, strict typecheck, production build |
| Tauri shell | Compiles and launches on Windows; **Linux and macOS bundles have never been built** |
| Mobile client | First Run, Photos, Files and Settings built; the viewer, search, albums and file actions are not |
| Host agent | Written, its HTTP contract tested; **not deployed** |
| Provisioning | Written, compiled into the binary; **never run** |
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
