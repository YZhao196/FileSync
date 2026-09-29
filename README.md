# FileSynapse

A self-hosted replacement for OneDrive and Google Photos, on hardware you already
own.

The desktop client watches a server from the tray — did the backup run, how full
is the disk, are the services up — and browses its photo and file libraries. It
is a **viewer, not an uploader**: camera upload stays with Immich's own app, and
file sync with Nextcloud's.

```
app/                React + TypeScript + Vite desktop client (Tauri shell)
infra/agent/        the host agent behind the status panel
infra/provision/    provisioning script, embedded into the binary
```

## Status

**Not yet functional end to end.** The client has never reached a real server,
and no server has been built. Everything that runs today runs against a
development mock.

| | |
|---|---|
| Client, screens, tests | Built — 84 tests, strict typecheck, production build |
| Tauri shell | Compiles and launches; installer bundles build |
| Host agent | Written, its HTTP contract tested; **not deployed** |
| Provisioning | Written, compiled into the binary; **never run** |
| Live Immich / Nextcloud clients | Written, **unverified** |

[`for-human.md`](for-human.md) lists what is left, in priority order.

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
2. [`for-human.md`](for-human.md) — what still needs a person.
3. [`UI-DESKTOP.md`](UI-DESKTOP.md) — screen specs. Older than the designs where
   they disagree.
4. [`app/README.md`](app/README.md) — running and testing the client.

`FileSync Frontend Designs.html` is the visual source of truth.

## Licence

Not yet decided. See PLAN.md §13–§14 for why the architecture is arm's-length:
the servers run **stock** and are configured rather than patched, and all of this
project's own code lives in the client, the installer and the scripts.
