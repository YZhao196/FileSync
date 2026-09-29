# FileSynapse

A self-hosted replacement for OneDrive and Google Photos, on hardware already
owned. `app/` is the desktop client; `infra/` is the server side.

## Where the truth lives

| | |
|---|---|
| `PLAN.md` | Every decision **and its reason**. Infrastructure, licensing, costs, open items |
| `FileSync Frontend Designs.html` | The visual source of truth. Newer than the markdown specs where they disagree |
| `UI-DESKTOP.md` · `UI-MOBILE.md` | Screen specs. Mobile is unbuilt |
| `for-human.md` | What needs a person, ordered by priority |
| `.claude/agents/` | Area-specific subagents — see [the index](.claude/AGENTS.md) |

Read the relevant spec before changing behaviour in an area, and update it in the
same pass. A plan describing the old shape is worse than none, because it is
confidently wrong.

## Rules that apply everywhere

**Never cross the process boundary, in either direction** (PLAN.md §13.4). No
Immich or Nextcloud code is copied, vendored or linked into this project, and no
of our code is patched into theirs. The client talks HTTP and nothing else — that
arm's-length distance is what keeps it proprietary. Run their servers **stock**;
configure, never patch.

**Tailscale only. Never port-forward anything.** 9090, 9443 and 8787 are
tailnet-only.

**Snapshots, never a mirror.** A sync tool propagates deletions, so a mirror
loses both copies. restic writes versioned snapshots; 7-day retention is
deliberate.

**Cut duplication, gate genuine options.** If a feature duplicates software
already installed (Nextcloud's own client, Immich's own web UI), delete it. If it
serves a different user or preference, ship it in one build and gate it at
runtime. *Ask which of the two a feature is* before proposing to delete or split
it — the whole path goes when the answer is delete.

**Label what has not been run.** Most of the live API surface has never touched a
real server. The convention is an explicit `UNVERIFIED:` comment naming what
needs checking. A labelled guess is useful; an unlabelled one is a trap.

**Build around blockers.** Work that needs a human — installing a toolchain,
deploying a service, supplying credentials — gets a placeholder and a
`for-human.md` entry, and the rest proceeds. Stop and ask only when a *decision*
is needed, not when an *action* is.

## Conventions the code depends on

- **Theme tokens, never hex.** `styles/theme.css` — both themes must work.
- **`<Icon>`, never emoji.** 16×16, `currentColor`, in `components/Icon.tsx`.
- **`go(screen, target)`, never a router.** Screens are a union in
  `state/store.tsx`; `NavTarget` carries the parameters. Deliberate.
- **All data via `backends`**, never a bare `fetch`. Screens do not know whether
  they are on placeholder data or a live server.
- **The browser build must keep working.** Every native capability goes through
  `native/bridge.ts` and degrades when the Tauri shell is absent.
- **No new runtime dependencies without saying so.** The client has React and
  nothing else, on purpose.

## Commands

```bash
cd app && npm run dev        # placeholder data, no server needed
cd app && npm test           # vitest
cd app && npm run typecheck  # strict
cd app && npm run build
```

A change is done when all three of typecheck, test and build pass **and** the
screen has actually been loaded. Say which half you verified when only one is
reachable.
