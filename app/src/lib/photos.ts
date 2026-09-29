/** Grouping and filtering shared by every screen that shows a wall of photos. */

import type { Photo } from '../core/types'

export type PhotoFilter = 'all' | 'photos' | 'videos' | 'favourites'

/**
 * What can be done to a photo.
 *
 * These are keys, not labels. The viewer draws the words and the collection
 * dispatches on these, so a rename of a button cannot silently unhook it —
 * which is exactly how "Add to album" would have broken.
 */
export type PhotoAction = 'favourite' | 'download' | 'share' | 'album' | 'delete'

export const FILTERS: ReadonlyArray<{ id: PhotoFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'photos', label: 'Photos' },
  { id: 'videos', label: 'Videos' },
  { id: 'favourites', label: 'Favourites' },
]

export function applyFilter(photos: Photo[], filter: PhotoFilter): Photo[] {
  switch (filter) {
    case 'photos':
      return photos.filter((p) => !p.isVideo)
    case 'videos':
      return photos.filter((p) => p.isVideo)
    case 'favourites':
      return photos.filter((p) => p.isFavourite)
    default:
      return photos
  }
}

/** Preserves first-seen order rather than sorting: the server already decided
 *  the order, and re-sorting client-side would fight it. */
export function groupPhotos(photos: Photo[]): Array<{ date: string; photos: Photo[] }> {
  const order: string[] = []
  const byDate = new Map<string, Photo[]>()
  for (const p of photos) {
    if (!byDate.has(p.dateGroup)) {
      byDate.set(p.dateGroup, [])
      order.push(p.dateGroup)
    }
    byDate.get(p.dateGroup)?.push(p)
  }
  return order.map((date) => ({ date, photos: byDate.get(date) ?? [] }))
}

export function groupAnchor(date: string): string {
  return `group-${date.replace(/\W+/g, '-').toLowerCase()}`
}

export function shortLabel(date: string): string {
  if (date === 'Today') return 'Today'
  if (date === 'Yesterday') return 'Yest.'
  const [month, year] = date.split(' ')
  return month && year ? `${month.slice(0, 3)} ${year.slice(2)}` : date
}

/**
 * A filename that survives a save dialog.
 *
 * Immich ids are reliable but not filenames; the original name is the one the
 * user recognises. Anything outside a conservative set is replaced, because
 * this string ends up as a path.
 *
 * The fallback fires when nothing identifying survives — a name of `___` is a
 * legal filename and a useless one, so it counts as empty. `download` at least
 * says what the file is.
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'download'
}
