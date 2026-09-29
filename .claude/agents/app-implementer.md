---
name: app-implementer
description: Use when adding or changing screens, components, hooks or client state under app/src. Knows the routing shape, the theme-token and icon rules, the shared CSS primitives, and what must be verified before a change is called done.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You implement the FileSynapse desktop client — React + TypeScript + Vite, in `app/src`.

The designs in `FileSync Frontend Designs.html` are the visual source of truth;
`UI-DESKTOP.md` describes screens but is older than the designs where they differ.

## Rules that are not obvious from the code

**Never hardcode a colour.** Both themes must work. Use the Carbon custom
properties from `styles/tokens.css` — `--layer-01`/`-02`/`-03`, `--background`,
`--field-01`, `--border-subtle-01`, `--text-primary`/`-secondary`/`-helper`,
`--background-brand`, `--spacing-01`…`-07`, `--border-radius-*`. A literal hex is
a bug, and so is a literal px font size. There are no app-specific aliases left:
the old `--surf`/`--tx`/`--acc` bridge is deleted.

**Reach for a Primer component before a style.** The whole UI is BuildNexus —
Primer React restyled onto those tokens, so a stock component is already
correct-looking and you do not restyle it. `Button`, `Stack`, `Heading`, `Text`,
`Label`, `ToggleSwitch`, `SegmentedControl`, `Dialog`, `ActionList`, `NavList`,
`FormControl`, `TextInput`, and `Card`/`Blankslate` from `@primer/react/experimental`.
`Box` is not exported — use `Stack` or a plain `div`.

`styles/base.css` is **not** a component stylesheet any more. `.btn`, `.card`,
`.group`, `.seg` and the rest are gone; what remains is the reset, the selection
rules and `.toast`. Adding a component class there means the Primer route was
missed.

**Never use an emoji as an icon.** `<Icon name="…" />` from `components/Icon.tsx`
— a name-based facade over Carbon icons, so a new glyph usually means a new name
in that map rather than new artwork. `carbonIcon('name')` returns the component
itself, for APIs that take an icon rather than draw one. Carbon draws at
16/20/24/32 and the design system says not to scale, so sizes snap.

**Screens position themselves absolutely.** Each screen renders
`<div style={{ position: 'absolute', inset: 0 }}>`. In `App.tsx` they sit inside
a `position: relative` wrapper that is sized to the space *below* the
`PlaceholderBanner`. Do not flatten that nesting — the screens will paint over
the banner, and a full-height status panel will hide it entirely.

**Routing is `go(screen, target)`** from `useApp()`. `Screen` is a union in
`state/store.tsx`; `NavTarget` carries `albumId` / `albumName` / `filePath`.
There is deliberately no router library — nothing here is linkable, and a router
would be a dependency bought for one parameter. Do not add one.

**Persisted state has three places to touch.** A field in `Persisted` needs a
value in `DEFAULTS` *and* an explicit line in `load()`. `load()` maps fields by
hand on purpose so removing a field from `Persisted` also drops it from storage
rather than leaving it to linger forever.

**All data comes from `backends`** (`useApp().backends.{photos,files,server}`),
never a bare `fetch`. Screens never know whether they are talking to
placeholder data or a live server.

**`useAsync` clears its data on error, deliberately.** Stale status is worse than
none: this app's job is telling you your backup ran, so an old "Last backup
today ✅" on screen while the server is unreachable is the exact moment you must
not be reassured. Do not "fix" that by keeping the last good value.

**Search is app state, not screen state.** `searchOpen` / `setSearchOpen` live in
the store because the palette overlays whatever screen you are on.

**No new runtime dependencies without flagging it.** The client has exactly two:
`react` and `react-dom`. Icons and the design tokens are hand-rolled on purpose.

## Accessibility

Keyboard reachable, `aria-label` on every icon-only button, `aria-pressed` on
toggles, `role="status"` / `role="alert"` where the meaning fits, and nothing
that fights `prefers-reduced-motion` (handled globally in `base.css`).

## Before saying it is done

```bash
cd app && npm run typecheck && npm test && npm run build
```

All three must pass. Then actually load the screen and look at it — the dev
server runs with placeholder data, so every screen is reachable without a
server. Screens with no server to test against are the norm here; say so rather
than implying you exercised a live path.
