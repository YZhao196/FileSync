/**
 * The caption cache.
 *
 * Keyed by Immich asset id. JSON rather than SQLite: Node 20 has no built-in
 * sqlite and a native driver would break the "no dependencies" rule this agent
 * is built on. The lookup is a `Map.get`, which is all this needs.
 *
 * Only the caption is cached, not the decision that follows it. The vision model
 * is the slow, memory-hungry half; re-running a 421M classifier over a caption
 * already in hand costs milliseconds. That is what makes a second pass free.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Bumped when the file's shape changes, so an old file reads as empty. */
const SCHEMA = 1

export function createCaptionStore({
  path,
  model,
  cap = 50000,
  debounceMs = 2000,
  onWarn = () => {},
}) {
  /** Loaded lazily; `null` means "not read from disk yet". */
  let entries = null
  let timer = null

  async function load() {
    if (entries) return entries
    entries = new Map()
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed?.v !== SCHEMA || typeof parsed.entries !== 'object' || parsed.entries === null) {
        return entries
      }
      for (const [id, entry] of Object.entries(parsed.entries)) {
        // An entry written by a different model is not comparable with one from
        // this one, so it counts as absent rather than being served as current.
        if (typeof entry?.c === 'string' && entry.m === model) {
          entries.set(id, { c: entry.c, m: entry.m, at: entry.at })
        }
      }
    } catch {
      // No file yet, or unreadable, or not JSON. All the same thing: no cache.
    }
    return entries
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, debounceMs)
    // Do not hold the process open for a pending write.
    timer.unref?.()
  }

  async function flush() {
    // An explicit flush supersedes a pending scheduled one. Without this a timer
    // armed before the flush can fire after it and write the older snapshot over
    // the newer one — which is how `clear()` could silently undo itself.
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    try {
      prune()
      const payload = JSON.stringify({ v: SCHEMA, entries: Object.fromEntries(entries) })
      await mkdir(dirname(path), { recursive: true })
      // Written to a sibling and renamed: a half-written file must never read as
      // truth, the same property `readBackupVerdict` relies on in agent.mjs.
      const tmp = `${path}.tmp`
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, path)
    } catch (err) {
      // An unwritable cache is a performance problem, not a failure. The caption
      // earned this request either way; it simply will not be remembered.
      onWarn(`caption store write failed: ${err?.message ?? err}`)
    }
  }

  function prune() {
    if (entries.size <= cap) return
    // Oldest first, so a scan that ran away cannot fill the disk. ISO timestamps
    // sort lexicographically, which avoids parsing every one of them.
    const oldest = [...entries.entries()].sort((a, b) =>
      String(a[1].at ?? '').localeCompare(String(b[1].at ?? '')),
    )
    for (const [id] of oldest.slice(0, entries.size - cap)) entries.delete(id)
  }

  return {
    async get(id) {
      return (await load()).get(id)?.c ?? null
    },

    async set(id, caption) {
      ;(await load()).set(id, { c: caption, m: model, at: new Date().toISOString() })
      schedule()
    },

    async size() {
      return (await load()).size
    },

    async clear() {
      const map = await load()
      const cleared = map.size
      map.clear()
      await flush()
      return cleared
    },

    /** Exposed so tests and shutdown paths can make a pending write land. */
    flush,
  }
}
