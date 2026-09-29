/**
 * The two path questions the app asks.
 *
 * Both were written three or four times as the screens grew — a `parentOf` in
 * the file browser, another in search, another in provisioning, and a same-disk
 * heuristic in the replace flow. One definition each, so a fix lands everywhere.
 *
 * These handle `/`-separated paths only, which is what every backend here uses:
 * WebDAV always, and the folder fields throughout are server-side Linux paths.
 */

/** The containing folder, or "/" at the root. */
export function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

/** Appends a name to a folder, tolerating the root's trailing slash. */
export function joinPath(parent: string, name: string): string {
  return `${parent === '/' ? '' : parent.replace(/\/+$/, '')}/${name}`
}

/**
 * Crude same-disk heuristic: two paths are "the same disk" when they sit under
 * the same parent.
 *
 * The server does this properly with device ids when provisioning; this is for
 * the warning shown before anything runs, where being approximately right is
 * the point — it is advice, not a gate.
 */
export function sameRoot(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && parentOf(a) === parentOf(b)
}
