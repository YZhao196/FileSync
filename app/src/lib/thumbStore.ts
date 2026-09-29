/**
 * On-disk thumbnail cache.
 *
 * PLAN.md §11 wants the thumbnail cache on each device — derived, disposable,
 * rebuildable — so scrolling does not query the server. An object URL dies with
 * the process, so a session-only cache cannot make a cold start faster; this is
 * the half that survives a restart.
 *
 * IndexedDB rather than a file: it persists in the Tauri webview exactly as it
 * does in a browser, needs no native command, and stores Blobs directly so a
 * thumbnail is never inflated into a string. Every failure path here is a
 * silent miss — a cache that throws is worse than no cache.
 */

const DB_NAME = 'filesynapse-thumbs'
const STORE = 'thumbs'
const VERSION = 1

/** Bumped when the cache should discard everything written before it. */
const SCHEMA = 'v1'

interface Row {
  key: string
  blob: Blob
  savedAt: number
}

export const cacheKey = (scope: string, size: string, id: number | string): string =>
  `${SCHEMA}|${scope}|${size}|${id}`

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, VERSION)
    } catch {
      return resolve(null)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    // Private mode, a full disk, a blocked upgrade — all just mean no cache.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const request = fn(tx.objectStore(STORE))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export async function getThumb(key: string): Promise<Blob | null> {
  const row = await run<Row | undefined>('readonly', (s) => s.get(key) as IDBRequest<Row | undefined>)
  return row?.blob ?? null
}

export function putThumb(key: string, blob: Blob): void {
  // Fire and forget: the image is already on screen, and a failed write only
  // means the next launch fetches it again.
  void run('readwrite', (s) => s.put({ key, blob, savedAt: Date.now() }) as IDBRequest<IDBValidKey>)
}

export async function clearThumbs(): Promise<void> {
  await run('readwrite', (s) => s.clear() as IDBRequest<undefined>)
}

export interface StoredStats {
  count: number
  bytes: number
}

/** Reads every row once, at startup, so the size in Settings is a real figure. */
export async function storedStats(): Promise<StoredStats> {
  const rows = await run<Row[]>('readonly', (s) => s.getAll() as IDBRequest<Row[]>)
  if (!rows) return { count: 0, bytes: 0 }
  return {
    count: rows.length,
    bytes: rows.reduce((sum, r) => sum + (r.blob?.size ?? 0), 0),
  }
}
