#!/usr/bin/env node
/**
 * The caption store's disk behaviour, which is the part that can lose data.
 *
 * Run with `node infra/agent/captionStore.test.mjs`. There is no test runner
 * here on purpose: this agent has no dependencies, and adding one to test a
 * sixty-line module would be a worse trade than a script that exits non-zero.
 *
 * The interesting properties are all about what happens across a restart, a
 * model change, and a file that is not what it claims to be — none of which a
 * single-process in-memory test would catch.
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCaptionStore } from './captionStore.mjs'

const STATE = join(dirname(fileURLToPath(import.meta.url)), 'captionStore.test-state.json')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  const got = ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${got}`)
}

await rm(STATE, { force: true })

try {
  // A restart is a new store reading the same file: the case a naive in-memory
  // cache would pass while the real thing lost everything.
  const first = createCaptionStore({ path: STATE, model: 'moondream', debounceMs: 5 })
  await first.set('id-1', 'a blurry photo of a dog at night')
  await first.set('id-2', 'a beach at sunset')
  await first.flush()

  const reopened = createCaptionStore({ path: STATE, model: 'moondream' })
  check('survives a restart', await reopened.get('id-1'), 'a blurry photo of a dog at night')
  check('reports its size', await reopened.size(), 2)
  check('misses an id it never saw', await reopened.get('nope'), null)

  // A caption from another model is not comparable with this one, so it must
  // read as absent rather than being served as if it were current.
  check(
    'a different model invalidates every entry',
    await createCaptionStore({ path: STATE, model: 'llava:7b' }).size(),
    0,
  )

  // A half-written or hand-edited file must degrade to "no cache", never throw:
  // the agent's whole convention is that a missing fact beats a failed request.
  await writeFile(STATE, 'this is not json')
  check('a corrupt file reads as empty', await createCaptionStore({ path: STATE, model: 'moondream' }).size(), 0)

  await writeFile(STATE, JSON.stringify({ v: 99, entries: { a: { c: 'x', m: 'moondream' } } }))
  check('an older schema reads as empty', await createCaptionStore({ path: STATE, model: 'moondream' }).size(), 0)

  const clearing = createCaptionStore({ path: STATE, model: 'moondream', debounceMs: 5 })
  await clearing.set('id-9', 'something')
  check('clear reports what it removed', await clearing.clear(), 1)
  check('and the clear persisted', await createCaptionStore({ path: STATE, model: 'moondream' }).size(), 0)

  // A scan writes in bursts. One write per caption would mean tens of thousands
  // of renames for a library, each a chance to be interrupted.
  const burst = createCaptionStore({ path: STATE, model: 'moondream', debounceMs: 30 })
  for (let i = 0; i < 50; i++) await burst.set(`bulk-${i}`, `caption ${i}`)
  await burst.flush()
  const raw = JSON.parse(await readFile(STATE, 'utf8'))
  check('a burst lands as one file', Object.keys(raw.entries).length, 50)
  check('written at the current schema', raw.v, 1)

  // The cap exists so a runaway scan cannot fill the partition the OS lives on.
  const capped = createCaptionStore({ path: STATE, model: 'moondream', cap: 10, debounceMs: 5 })
  for (let i = 0; i < 25; i++) await capped.set(`many-${i}`, `caption ${i}`)
  await capped.flush()
  check('prunes down to the cap', await capped.size(), 10)
} finally {
  await rm(STATE, { force: true })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
