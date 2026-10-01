#!/usr/bin/env node
/**
 * The mobile client shares the desktop client's logic layer by copy, and this
 * keeps the copy honest.
 *
 * PLAN.md §11 chose two separate UI implementations — screens written twice,
 * logic shared. The obvious way to share is a workspace package, and it was
 * rejected here on purpose: it would move the lockfile to the repo root and make
 * `app/` depend on something outside its own directory, which is a documented
 * convention (app/README.md, PLAN.md §13.3) that exists for a reason.
 *
 * So the files are copied instead, and this script is the thing that stops the
 * copies rotting. `--check` is what CI runs.
 *
 * Why a copy is worth policing rather than just accepting: `remote.ts` and
 * `mock.ts` carry roughly 1,200 lines of API knowledge that was checked against
 * Immich's OpenAPI spec and Nextcloud's WebDAV docs by hand — the v3.0.0 album
 * change, the `INDIVIDUAL` share-link rule, the valid `size` values. That kind of
 * detail is fixed in one place and then quietly wrong in the other. Everything
 * else in the list is here for consistency rather than risk.
 *
 * Run with `node scripts/sync-core.mjs` to write the copies, or
 * `node scripts/sync-core.mjs --check` to fail when they have drifted.
 *
 * The copies are byte-identical on purpose. The mobile app supplies its own
 * `src/native/bridge.ts` — mirroring the directory layout is what lets
 * `remote.ts`'s `../native/bridge` import resolve unchanged — and shims the
 * globals it needs at its entry point. Nothing is rewritten on the way across,
 * so `--check` is a plain byte comparison and cannot itself be wrong.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FROM = join(ROOT, 'app', 'src')
const TO = join(ROOT, 'mobile', 'src')

/**
 * Files copied verbatim, relative to `app/src` and `mobile/src`.
 *
 * Deliberately absent, and why:
 *   core/client.ts        `import.meta.env` is a Metro parse error, and the
 *                         half that matters — createBackends, testConnection —
 *                         is per-platform anyway. Mobile writes its own.
 *   core/client.test.ts   tests the file above. Nothing to copy.
 *   core/connection.test.ts
 *                         tests the shared `connection.ts`, but does it with
 *                         `vi.mock`/`vi.hoisted` module mocking, which the Jest
 *                         shim cannot stand in for: Jest hoists a literal
 *                         `jest.mock(...)` call above the imports, and a
 *                         forwarded `vi.mock` would run too late to matter. The
 *                         subject is shared and identical; only the runner
 *                         mechanics are not, so the desktop verifies it and the
 *                         mobile copy simply is not made.
 *   lib/platform.ts       navigator/window, file-manager names, ⌘K — desktop.
 *   lib/platform.test.ts  tests the file above.
 *   lib/thumbStore.ts     IndexedDB. Mobile keeps thumbnails as files.
 *   lib/thumbCache.ts     URL.createObjectURL. RN has no such thing.
 */
const FILES = [
  'core/types.ts',
  'core/backends.ts',
  'core/mock.ts',
  'core/remote.ts',
  'core/connection.ts',
  'lib/format.ts',
  'lib/paths.ts',
  'lib/photos.ts',
  'lib/backup.ts',
  // The tests come too, so the shared logic is verified on both platforms by
  // the same assertions rather than by two suites that drift apart.
  'core/mock.test.ts',
  'core/remote.test.ts',
  'lib/format.test.ts',
  'lib/photos.test.ts',
  'lib/paths.test.ts',
]

const check = process.argv.includes('--check')

/** `ok` | `differs` | `missing` — read as bytes, so a line-ending difference counts. */
function compare(rel) {
  let ours
  try {
    ours = readFileSync(join(FROM, rel))
  } catch {
    return 'source-missing'
  }
  let theirs
  try {
    theirs = readFileSync(join(TO, rel))
  } catch {
    return 'missing'
  }
  return ours.equals(theirs) ? 'ok' : 'differs'
}

if (!check) {
  let written = 0
  for (const rel of FILES) {
    const source = join(FROM, rel)
    const dest = join(TO, rel)
    const bytes = readFileSync(source) // throws if a listed file was renamed
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, bytes)
    written += 1
    console.log(`  copied  ${rel}`)
  }
  console.log(`\n${written} files copied into mobile/src — they are byte-identical to app/src.`)
  console.log('Run with --check before committing; CI does.')
  process.exit(0)
}

const results = FILES.map((rel) => [rel, compare(rel)])
const bad = results.filter(([, state]) => state !== 'ok')

if (bad.length) {
  console.error('The mobile copy of the shared logic has drifted from app/src:\n')
  for (const [rel, state] of bad) {
    const note =
      state === 'missing'
        ? 'not copied into mobile/src'
        : state === 'source-missing'
          ? 'listed here but gone from app/src — it was renamed or deleted'
          : 'differs from app/src'
    console.error(`  ${state.padEnd(14)} ${rel} — ${note}`)
  }
  console.error('\nmobile/src holds copies, not links. A fix to the shared logic has to')
  console.error('land in app/src and be re-copied, or the two clients will disagree about')
  console.error('the API in ways neither test suite can see. Run: node scripts/sync-core.mjs')
  process.exit(1)
}

console.log(`${FILES.length} shared files — identical to app/src`)
