#!/usr/bin/env node
/**
 * Carbon design tokens, as the mobile client can actually use them.
 *
 * React Native has no cascade and no custom properties — a style is a plain
 * object. So `app/src/styles/tokens.css`, which is the desktop's source of
 * truth and stays it, cannot be read at runtime here. This turns it into a
 * module.
 *
 * It parses rather than restates, deliberately. A hand-written copy of the
 * palette would be a second source of truth that agrees with the first only on
 * the day it was written, and the project's rule is theme tokens rather than
 * hex — a rule that needs one list in one place to mean anything.
 *
 * The token *names* are the Carbon ones, unchanged: `layer-01`, `text-primary`,
 * `spacing-05`. Nobody should have to learn a second vocabulary to style a
 * mobile screen.
 *
 * `tokens.css` says in its header that it is generated from `tokens.json`. No
 * such file exists in the repository, so `tokens.css` is the source here. If a
 * `tokens.json` is ever restored, this should read that instead and both
 * generators should agree.
 *
 * Run `node scripts/gen-mobile-tokens.mjs` to write, or with `--check` to fail
 * when the generated file is stale. CI runs the check.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SOURCE = join(ROOT, 'app', 'src', 'styles', 'tokens.css')
const OUT = join(ROOT, 'mobile', 'src', 'theme', 'tokens.generated.ts')

const css = readFileSync(SOURCE, 'utf8')

/** The body of the first rule whose header matches, brace-counted to its end. */
function blockBody(header) {
  const start = css.indexOf(header)
  if (start < 0) throw new Error(`tokens.css has no "${header}" block`)

  const open = css.indexOf('{', start)
  let depth = 0

  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`the "${header}" block is never closed`)
}

/** `--name: value;` lines, in file order. Comments after the semicolon are dropped. */
function declarations(body) {
  const out = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*--([a-z0-9-]+)\s*:\s*(.+?);\s*(?:\/\*.*\*\/)?\s*$/)
    if (match) out.push([match[1], match[2].trim()])
  }
  return out
}

const light = declarations(blockBody(':root, [data-theme="light"]'))
const dark = declarations(blockBody('[data-theme="dark"]'))
const shared = declarations(blockBody(':root {'))

// The dark block is a full set, not an override list, so both themes carry every
// name. Asserting it here is cheaper than discovering a missing token as an
// undefined style on a dark-mode screen.
const lightNames = new Set(light.map(([n]) => n))
const missing = dark.map(([n]) => n).filter((n) => !lightNames.has(n))
if (missing.length) {
  throw new Error(`dark has tokens light does not: ${missing.join(', ')}`)
}

/** `'IBM Plex Sans', system-ui, …` → `IBM Plex Sans`. */
function fontFamily(value) {
  const ref = value.match(/var\(--font-(sans|mono)\)/)
  if (ref) return ref[1] === 'mono' ? 'IBM Plex Mono' : 'IBM Plex Sans'
  const first = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  return first
}

/** Single quotes, to match the rest of the codebase — `JSON.stringify` would not. */
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** A colour token's value is used as-is; React Native takes the same strings. */
const emitColors = (pairs) =>
  pairs.map(([name, value]) => `  '${name}': ${quote(value)},`).join('\n')

/** `2px` → `2`. React Native wants a number for anything it can do arithmetic on. */
function px(name, value) {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!match) throw new Error(`"${name}" is not a px length: ${value}`)
  return Number(match[1])
}

const spacing = shared.filter(([n]) => n.startsWith('spacing-'))
const radii = shared.filter(([n]) => n.startsWith('border-radius-'))

/**
 * The `--text-*` tokens are CSS `font` shorthands — `400 12px/1.333 var(…)` — and
 * React Native has no equivalent, so they are split into the four properties it
 * does have. The line height is a ratio in CSS and a length in React Native, so
 * it is resolved to pixels here rather than left for each screen to multiply.
 */
const textTokens = shared
  .filter(([n]) => n.startsWith('text-'))
  .map(([name, value]) => {
    const match = value.match(/^(\d+)\s+(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)\s+(.+)$/)
    if (!match) throw new Error(`"${name}" is not a font shorthand: ${value}`)
    const [, weight, size, ratio, family] = match
    return [
      name,
      {
        // A string, not a number: Android needs the named or numeric weight as
        // a string and silently ignores it otherwise.
        fontWeight: weight,
        fontSize: Number(size),
        lineHeight: Math.round(Number(size) * Number(ratio)),
        fontFamily: fontFamily(family),
      },
    ]
  })

const output = `/**
 * Generated by scripts/gen-mobile-tokens.mjs from app/src/styles/tokens.css.
 * Do not edit — edit the stylesheet and re-run, or the two clients will drift.
 *
 * Carbon token names, unchanged. There are no aliases here on purpose: the
 * desktop's rule is theme tokens rather than hex, and a second set of names
 * would be a second thing to learn.
 */

export const lightColors = {
${emitColors(light)}
} as const

export const darkColors = {
${emitColors(dark)}
} as const

export type ThemeName = 'light' | 'dark'

/**
 * Widened from lightColors on purpose. Both themes are \`as const\`, so their
 * literal types are the literal hex values — and dark's are not assignable to
 * light's. This keeps the token *names* checked while letting the values differ,
 * which is the whole point of having two themes.
 */
export type ThemeColors = { [K in keyof typeof lightColors]: string }

/** Carbon spacing, in density-independent pixels. */
export const spacing = {
${spacing.map(([n, v]) => `  '${n}': ${px(n, v)},`).join('\n')}
} as const

export const radius = {
${radii.map(([n, v]) => `  '${n.replace('border-radius-', '')}': ${px(n, v)},`).join('\n')}
} as const

export const fonts = {
  sans: ${quote(fontFamily(shared.find(([n]) => n === 'font-sans')[1]))},
  mono: ${quote(fontFamily(shared.find(([n]) => n === 'font-mono')[1]))},
} as const

/** The \`--text-*\` shorthands, split into the four properties React Native has. */
export const text = {
${textTokens
  .map(
    ([name, t]) =>
      `  '${name}': { fontWeight: ${quote(t.fontWeight)}, fontSize: ${t.fontSize}, lineHeight: ${t.lineHeight}, fontFamily: ${quote(t.fontFamily)} },`,
  )
  .join('\n')}
} as const

export type TextToken = keyof typeof text
`

if (process.argv.includes('--check')) {
  let current = null
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error(`${OUT} is missing. Run: node scripts/gen-mobile-tokens.mjs`)
    process.exit(1)
  }
  if (current !== output) {
    console.error('mobile/src/theme/tokens.generated.ts is stale.')
    console.error('app/src/styles/tokens.css has changed since it was generated.')
    console.error('Run: node scripts/gen-mobile-tokens.mjs')
    process.exit(1)
  }
  console.log(`tokens — ${light.length} colours per theme, up to date with tokens.css`)
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, output)
console.log(
  `wrote ${light.length} colours × 2 themes, ${spacing.length} spacing, ` +
    `${radii.length} radii, ${textTokens.length} text tokens`,
)
