# BuildNexus migration brief

The FileSynapse client (`app/`) is mid-migration from its own hand-rolled
components to **BuildNexus** — Carbon v11 tokens, Primer React 38.40 components,
IBM Plex type, Carbon icons. The foundation is done and verified; what remains
is converting the screens.

**Read these first:**

- `app/src/components/ChoiceScreen.tsx` — already converted. This is the pattern.
- `C:\Users\yongz\OneDrive - Deakin University\Career\Startup\BuildNexus-design-system\BuildNexus\README.md`
  — the design system's own rules.
- The per-component spec for anything you use:
  `…\BuildNexus\components\<Name>\README.md`

## What BuildNexus is

Primer React, restyled. `app/src/styles/tokens.css` holds Carbon's tokens;
`app/src/styles/buildnexus.css` holds Primer plus a remap that points Primer's
own variables at those tokens. So **a Primer component is already
BuildNexus-styled** — you do not restyle it, you use it.

`app/src/styles/theme.css` is a temporary bridge mapping the app's old token
names (`--surf`, `--tx`, `--acc`) onto Carbon. Leave it alone: other files still
use those names. Prefer the Carbon names (`--layer-01`, `--text-primary`) in new
code.

## Design rules

**Content**
- Sentence case everywhere — buttons, titles, menu items, table headers.
- Address the reader as "you". Lead button labels with a verb, 1–3 words.
- No exclamation marks, no emoji, no jokes in system messages.
- Numerals for all numbers ("2 minutes", "5 checks").

**Colour**
- Build from layers, not shadows: `--background` → `--layer-01` → `--layer-02`
  → `--layer-03`. On `layer-01` use `--field-01`, `--border-subtle-01`,
  `--layer-hover-01`.
- Never add a `box-shadow`. Only overlays (menus, popovers, modals) are raised,
  via `--shadow-overlay`.
- `--text-primary` for body and headings, `--text-secondary` for labels and
  descriptions, `--text-helper` for helper text, `--text-on-color` on brand fills.
- `--background-brand` (#0f62fe) is the one brand hue. One `primary` Button per
  view.
- Status colour **always** comes with an icon and a word — success and error
  differ by hue only, so colour alone never carries meaning.

**Type** — no literal px sizes.
- `body-compact-01` (14/1.286) is default UI text; `heading-compact-01`/`-02`
  inside components; `heading-04` for page titles; `label-01` for labels and
  table headers; `code-01`/`code-02` for code and logs.
- Helpers: `className="label-01"`, `className="body-compact-01"`,
  `className="code-02"` etc. are available as classes.

**Space and shape**
- `--spacing-05` (16px) inside components, `--spacing-06` between control
  groups, `--spacing-07` between cards and form sections.
- Controls 32px (small), 40px (medium, default), 48px (large).
- `--border-radius-medium` (6px) buttons/fields/cards, `--border-radius-large`
  (12px) dialogs/popovers, `--border-radius-small` (3px) checkboxes/counters,
  `--border-radius-full` pills.
- Every interactive element shows a 2px `--focus` ring on keyboard focus.

## Components

From `@primer/react`:
`Button`, `IconButton`, `Heading`, `Text`, `Stack`, `Label`, `StateLabel`,
`NavList`, `ActionList`, `SegmentedControl`, `ToggleSwitch`, `Dialog`,
`ConfirmationDialog`, `Flash`, `TreeView`, `Tooltip`, `UnderlineNav`,
`PageLayout`, `PageHeader`, `Pagination`, `Avatar`, `Spinner`, `SubNav`,
`Timeline`, `Checkbox`, `Radio`, `Select`, `Textarea`, `Details`, `Truncate`,
`CounterLabel`, `Link`, `BaseStyles`, `ThemeProvider`, `FormControl`, `TextInput`.

From `@primer/react/experimental`:
`Card`, `Blankslate`, `SkeletonText`, `SkeletonAvatar`, `DataTable`, `Table`,
`InlineMessage`, `UnderlinePanels`, `IssueLabel`.

**`Box` is not exported.** Use `Stack` or a plain `div`.

**`Card` drops arbitrary children.** Once a `Card.*` subcomponent is present,
anything else passed as a child is silently not rendered — no warning. Use
`Card` as a plain container with token-styled elements when the content does not
map onto `Card.Heading` / `Card.Description` / `Card.Action`.

Icons — `import { Icon, carbonIcon } from '<relative>/components/Icon'`:
- `<Icon name="folder" size={16} />` — sizes snap to Carbon's 16/20/24/32.
- `carbonIcon('folder')` returns the Carbon component, for APIs that take an
  icon rather than drawing one (`Card.Icon`, a Button's `leadingVisual`).
- Names: `search image folder folder-list file file-text file-image archive
  check alert play star upload download external refresh close settings back add`.
- Do not add an `Icon` just to decorate. Icons sit beside a word, or carry an
  `aria-label` when alone.

## Hard rules

- **Presentation only.** Do not change behaviour, props, exports or file names.
- Do not touch `src/core/`, `src/state/`, `src/lib/`, `src/hooks/`, `src/native/`,
  `src/styles/`, or any `*.test.ts`.
- No literal hex colours and no literal px font sizes — use the tokens.
- Keep every comment that explains a non-obvious decision. Drop any that only
  restates the code.
- Preserve `aria-label`, `role`, and keyboard handling.
- Keep the existing layout structure unless a Primer component replaces it.

## Verify

```bash
cd app && npx tsc --noEmit
```

Fix any error in a file you touched. **Do not run `npm test` or `npm run build`**
— every agent shares one working tree and those are run centrally.

Report in under 150 words: files changed, and anything you could not convert and
why.
