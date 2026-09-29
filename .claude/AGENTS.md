# Agents

Project-specific subagents for FileSynapse, in [`agents/`](agents/). Each carries
the conventions and traps of one part of this codebase, so work in that area
starts from the rules rather than rediscovering them.

| Agent | Reach for it when |
|---|---|
| [`app-implementer`](agents/app-implementer.md) | Adding or changing screens, components, hooks or client state under `app/src` |
| [`backend-integrator`](agents/backend-integrator.md) | Immich / Nextcloud / agent HTTP work, a new backend method, or debugging live mode |
| [`shell-engineer`](agents/shell-engineer.md) | Anything in `app/src-tauri` — Rust commands, plugins, capabilities, the keychain, the tray |
| [`infra-engineer`](agents/infra-engineer.md) | `infra/` — provisioning, compose, restic, Tailscale, deploying the agent |
| [`agpl-guard`](agents/agpl-guard.md) | Reviewing any change that touches how this project relates to Immich or Nextcloud. Read-only |
| [`test-author`](agents/test-author.md) | Adding or fixing tests, or a change that needs coverage |
| [`docs-keeper`](agents/docs-keeper.md) | A change alters a documented decision, or the docs have drifted from the code |
| [`release-engineer`](agents/release-engineer.md) | Packaging, signing, versioning, or deciding what a release may include |

## Why these eight

They map to the project's actual workstreams, and each encodes at least one rule
that is **not inferable from reading the code**:

- **`agpl-guard`** — the arm's-length boundary. The most unusual constraint here,
  and the one nobody would guess. It decides the architecture.
- **`backend-integrator`** — `x-api-key` rather than Bearer, no `apiKey` query
  parameter, the `all` permission requirement, and CORS.
- **`app-implementer`** — theme tokens over hex, `<Icon>` over emoji,
  `go(screen, target)` over a router, and three places to touch when persisting
  state.
- **`shell-engineer`** — the browser build must keep working, and `keyring`
  silently fakes it without the right features enabled.
- **`infra-engineer`** — Tailscale only, snapshots not mirrors, and the provision
  script's output is a contract with the UI.
- **`test-author`** — locale-tolerant date assertions, and what has historically
  been worth testing.
- **`docs-keeper`** — drift is a bug; `_superseded/` is not live code.
- **`release-engineer`** — the licence position changes the moment this ships to
  someone else.

## Adding one

Create `.claude/agents/<name>.md` **with YAML frontmatter** — a file without it
is not a valid definition:

```markdown
---
name: my-agent
description: Use when…
tools: Read, Grep, Glob
---

The prompt. Lead with the rules that are not derivable from the code, name the
files they apply to, and say how the agent should verify its own work.
```

Keep this index and the `CLAUDE.md` pointer in step when you add one.

Write the body for someone competent who has never seen this project — the
non-obvious constraints are the whole value, and a generic prompt would be better
served by the built-in agents.
