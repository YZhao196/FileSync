#!/usr/bin/env node
/**
 * The version lives in three files and they have to agree.
 *
 * `npm run build` reads `package.json`, Tauri names the installer from
 * `tauri.conf.json`, and `Settings → About` shows the version the Rust binary
 * was built with — which comes from `Cargo.toml`. Bump two of the three and the
 * app will confidently display a version that is not the one you shipped.
 *
 * Run with `npm run check-versions`, and in CI on every push.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')

/** Only the `[package]` section — dependencies have `version` keys too. */
function cargoVersion(toml) {
  const lines = toml.split('\n')
  const start = lines.findIndex((l) => l.trim() === '[package]')
  if (start < 0) return null
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('[')) break // left the section
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"/)
    if (match) return match[1]
  }
  return null
}

const found = [
  ['app/package.json', JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).version],
  ['app/src-tauri/tauri.conf.json', JSON.parse(readFileSync(join(APP, 'src-tauri', 'tauri.conf.json'), 'utf8')).version],
  ['app/src-tauri/Cargo.toml', cargoVersion(readFileSync(join(APP, 'src-tauri', 'Cargo.toml'), 'utf8'))],
]

const missing = found.filter(([, v]) => !v)
if (missing.length) {
  console.error(`Could not read a version from: ${missing.map(([f]) => f).join(', ')}`)
  process.exit(1)
}

const versions = new Set(found.map(([, v]) => v))
if (versions.size > 1) {
  console.error('The version disagrees between files:\n')
  for (const [file, v] of found) console.error(`  ${v.padEnd(10)} ${file}`)
  console.error('\nAll three must match, or the installer, the build and Settings → About')
  console.error('will each claim a different version.')
  process.exit(1)
}

console.log(`version ${[...versions][0]} — consistent across all three files`)
