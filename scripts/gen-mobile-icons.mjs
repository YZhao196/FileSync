#!/usr/bin/env node
/**
 * Carbon icons, as data the mobile client can draw.
 *
 * The desktop gets its icons from `@carbon/icons-react`, which renders DOM
 * `<svg>` elements and cannot run in React Native. React Native draws through
 * `react-native-svg` instead, so what it needs is the geometry, not a
 * component.
 *
 * `@carbon/icons` already ships exactly that: each icon is a plain object
 * describing its `viewBox` and a list of child elements. This imports those
 * objects and writes them out as a TypeScript module, which is the same
 * arrangement as the design tokens and for the same reason — the artwork stays
 * Carbon's, there is one copy of it, and nothing is redrawn by hand.
 *
 * The *names* are ours and match `app/src/components/Icon.tsx` exactly, so
 * "which icon means a folder" has one answer across both clients. The one
 * addition is `grid`, which the mobile tab bar needs and the desktop never did.
 *
 * Every Carbon icon is drawn on a 32-unit grid regardless of the size variant,
 * so one `viewBox` covers all of them and scaling is the caller's business.
 *
 * Run `node scripts/gen-mobile-icons.mjs` to write, or with `--check` to fail
 * when it is stale. CI runs the check. `@carbon/icons` is a devDependency: it is
 * read here and never bundled.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CARBON = join(ROOT, 'mobile', 'node_modules', '@carbon', 'icons', 'es')
const OUT = join(ROOT, 'mobile', 'src', 'components', 'icons.generated.ts')

/**
 * Our name → Carbon's directory name. Mirrors `app/src/components/Icon.tsx`;
 * `filled` is the solid variant, where Carbon ships one.
 */
const ICONS = {
  search: { outline: 'search' },
  image: { outline: 'image' },
  folder: { outline: 'folder' },
  'folder-list': { outline: 'folder--details' },
  file: { outline: 'document' },
  'file-text': { outline: 'document--blank' },
  'file-image': { outline: 'image' },
  archive: { outline: 'zip' },
  check: { outline: 'checkmark', filled: 'checkmark--filled' },
  alert: { outline: 'warning', filled: 'warning--filled' },
  play: { outline: 'play', filled: 'play--filled' },
  star: { outline: 'star', filled: 'star--filled' },
  upload: { outline: 'upload' },
  download: { outline: 'download' },
  external: { outline: 'launch' },
  refresh: { outline: 'renew' },
  close: { outline: 'close' },
  settings: { outline: 'settings' },
  back: { outline: 'arrow--left' },
  add: { outline: 'add' },
  // Mobile only. The Photos tab is a grid per UI-MOBILE.md; the desktop has no
  // tab bar and never needed one.
  grid: { outline: 'grid' },
}

/** Every icon is on the same grid, so this is a constant rather than per-icon. */
const VIEW_BOX = '0 0 32 32'

/** Elements react-native-svg can draw that Carbon's 16px icons actually use. */
const SUPPORTED = new Set(['path', 'circle', 'rect', 'polygon'])

/**
 * Carbon's directory names are not all lower case — the archive icon lives in
 * `ZIP`, not `zip` — and Windows resolves either because its filesystem is
 * case-insensitive. Linux does not, so the mismatch was invisible on the
 * machine this was written on and failed the moment CI ran it.
 *
 * Resolved by lookup rather than by correcting the one name that happened to be
 * wrong: hardcoding `ZIP` fixes today's failure and leaves the next one to be
 * found the same way, in CI, by someone who did not write the mapping.
 */
let directories = null

function resolveDirectory(name) {
  if (!directories) {
    directories = new Map(readdirSync(CARBON).map((entry) => [entry.toLowerCase(), entry]))
  }
  const actual = directories.get(name.toLowerCase())
  if (!actual) throw new Error(`@carbon/icons has no "${name}"`)
  return actual
}

async function load(carbonName) {
  const file = join(CARBON, resolveDirectory(carbonName), '16.js')
  let descriptor
  try {
    descriptor = (await import(pathToFileURL(file).href)).default
  } catch (err) {
    throw new Error(`@carbon/icons has no "${carbonName}": ${err.message}`)
  }

  if (!descriptor?.content) throw new Error(`"${carbonName}" has no content`)

  // Checked rather than silently dropped: an element that went missing would
  // render as a partial glyph, which reads as a drawing mistake in the icon
  // rather than as a gap in this generator.
  for (const el of descriptor.content) {
    if (!SUPPORTED.has(el.elem)) {
      throw new Error(`"${carbonName}" uses <${el.elem}>, which this generator does not emit`)
    }
  }
  return descriptor.content
}

/** Camel-cases SVG attribute names: `fill-rule` → `fillRule`. */
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

function shape(el) {
  // `fill` and `stroke` are dropped — colour comes from the theme at render
  // time, which is what `currentColor` does on the desktop. Everything else
  // geometric is kept, `width`/`height` included: a `<rect>` has no other way
  // to say how big it is, and dropping them here would emit an invisible shape
  // rather than an error.
  const keep = ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'points', 'fill-rule']
  const attrs = []
  for (const [k, v] of Object.entries(el.attrs ?? {})) {
    if (k === 'fill' || k === 'stroke' || k === 'xmlns') continue
    if (!keep.includes(k) && !keep.some((s) => camel(s) === k)) continue
    attrs.push(`${camel(k)}: ${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "\\'")}'`}`)
  }
  return `{ tag: '${el.elem}', ${attrs.join(', ')} }`
}

const entries = []
for (const [name, variant] of Object.entries(ICONS)) {
  const outline = await load(variant.outline)
  const line = [`  '${name}': { outline: [${outline.map(shape).join(', ')}]`]
  if (variant.filled) {
    const filled = await load(variant.filled)
    line.push(`, filled: [${filled.map(shape).join(', ')}]`)
  }
  line.push(' },')
  entries.push(line.join(''))
}

const output = `/**
 * Generated by scripts/gen-mobile-icons.mjs from @carbon/icons. Do not edit.
 *
 * Carbon artwork (Apache-2.0), one 32-unit grid for every icon, and names that
 * match app/src/components/Icon.tsx so both clients agree on which glyph means
 * what.
 */

export interface IconShape {
  readonly tag: 'path' | 'circle' | 'rect' | 'polygon'
  readonly d?: string
  readonly cx?: number
  readonly cy?: number
  readonly r?: number
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly points?: string
  readonly fillRule?: 'evenodd' | 'nonzero'
}

export interface IconVariant {
  readonly outline: readonly IconShape[]
  readonly filled?: readonly IconShape[]
}

export const VIEW_BOX = '${VIEW_BOX}'

export const icons = {
${entries.join('\n')}
} as const

export type IconName = keyof typeof icons
`

if (process.argv.includes('--check')) {
  let current = null
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error(`${OUT} is missing. Run: node scripts/gen-mobile-icons.mjs`)
    process.exit(1)
  }
  if (current !== output) {
    console.error('mobile/src/components/icons.generated.ts is stale.')
    console.error('Run: node scripts/gen-mobile-icons.mjs')
    process.exit(1)
  }
  console.log(`icons — ${entries.length} up to date with @carbon/icons`)
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, output)
console.log(`wrote ${entries.length} icons`)
