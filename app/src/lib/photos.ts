/** Grouping and filtering shared by every screen that shows a wall of photos. */

import type { Photo, PhotoId } from '../core/types'

export type PhotoFilter = 'all' | 'photos' | 'videos' | 'favourites' | 'review'

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

/**
 * The cull queue, kept out of `FILTERS` on purpose.
 *
 * The other four always mean something. This one needs scores to exist and the
 * optional decision pipeline to be on, so the toolbar adds it only then — a
 * chip that is permanently empty would read as a broken feature rather than an
 * unconfigured one.
 */
export const REVIEW_FILTER: { id: PhotoFilter; label: string } = {
  id: 'review',
  label: 'Needs review',
}

/**
 * `scores` is only consulted for the review filter, so the other four behave
 * exactly as they did before the pipeline existed.
 */
export function applyFilter(
  photos: Photo[],
  filter: PhotoFilter,
  scores?: ReadonlyMap<PhotoId, number>,
): Photo[] {
  switch (filter) {
    case 'photos':
      return photos.filter((p) => !p.isVideo)
    case 'videos':
      return photos.filter((p) => p.isVideo)
    case 'favourites':
      return photos.filter((p) => p.isFavourite)
    case 'review': {
      // Unscored photos are left out rather than treated as worst: the queue
      // ranks what the model has actually looked at, and putting the rest first
      // would fill it with everything the pipeline has not reached yet.
      const scored = photos.filter((p) => scores?.has(p.id))
      return scored.sort((a, b) => (scores?.get(a.id) ?? 0) - (scores?.get(b.id) ?? 0))
    }
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
 * user recognises.
 *
 * **This is a blocklist, not an allowlist**, and the distinction matters before
 * anyone changes it. It replaces the characters that are separators or illegal
 * on the systems this runs on — `/` and `\`, which would change where the file
 * lands, `: * ? " < > |`, which Windows refuses, and the control characters.
 * Everything else passes through, including whatever Unicode the name carries,
 * because replacing a user's emoji with an underscore is the worse outcome.
 *
 * So a character that turns out to be dangerous has to be *added to the
 * pattern*. An earlier version of this comment called it "a conservative set",
 * which reads as an allowlist and would have somebody removing a character from
 * it instead — the opposite fix, in the one function whose whole job is making
 * a string safe as a path.
 *
 * `..` is handled by the fallback rather than by the pattern: `.` is legal in a
 * filename and `..` is not a filename, and `..` contains nothing alphanumeric,
 * so it is caught below along with names that are entirely punctuation.
 *
 * Not handled, and not reachable through the app: Windows device names — `CON`,
 * `NUL`, `COM1` and the rest. The save dialog refuses those before this sees
 * one, and on Android they are ordinary filenames. A pathologically long name
 * is not truncated either; it fails at the filesystem with a message naming the
 * file, which is loud rather than silent.
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'download'
}
