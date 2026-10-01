import { describe, expect, it } from 'vitest'
import { applyFilter, groupPhotos, safeFilename } from './photos'
import type { Photo, PhotoId } from '../core/types'

/**
 * The review filter is the first conditional one, which is why this file exists
 * now: `applyFilter` spent its whole life as four predicates and a passthrough,
 * and a filter that silently drops photos is a bug you would not notice until a
 * cull queue had already been trusted with deletions.
 */

const photo = (id: PhotoId, over: Partial<Photo> = {}): Photo => ({
  id,
  name: `${id}.jpg`,
  dateGroup: 'September 2026',
  takenAt: '2026-09-12T10:00:00.000Z',
  isVideo: false,
  isFavourite: false,
  gradient: ['#000', '#fff'],
  ...over,
})

const scores = (pairs: Array<[PhotoId, number]>) => new Map(pairs)

describe('applyFilter', () => {
  const photos = [
    photo('a', { isVideo: true }),
    photo('b', { isFavourite: true }),
    photo('c'),
  ]

  it('keeps the four original filters behaving exactly as before', () => {
    expect(applyFilter(photos, 'all').map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(applyFilter(photos, 'photos').map((p) => p.id)).toEqual(['b', 'c'])
    expect(applyFilter(photos, 'videos').map((p) => p.id)).toEqual(['a'])
    expect(applyFilter(photos, 'favourites').map((p) => p.id)).toEqual(['b'])
  })

  it('ignores scores for every filter but review', () => {
    const withScores = scores([['b', 0.1]])
    expect(applyFilter(photos, 'all', withScores).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  describe('review', () => {
    it('orders weakest first', () => {
      const s = scores([
        ['a', 0.9],
        ['b', 0.2],
        ['c', 0.5],
      ])
      expect(applyFilter(photos, 'review', s).map((p) => p.id)).toEqual(['b', 'c', 'a'])
    })

    it('leaves out photos the model has not looked at', () => {
      // The queue is what has been scored, not everything. Putting unscored
      // photos in — at either end — would make it a list of the whole library
      // wearing a review label.
      const s = scores([['c', 0.4]])
      expect(applyFilter(photos, 'review', s).map((p) => p.id)).toEqual(['c'])
    })

    it('returns nothing rather than everything when there are no scores', () => {
      expect(applyFilter(photos, 'review', scores([]))).toEqual([])
      expect(applyFilter(photos, 'review')).toEqual([])
    })

    it('does not mutate the array it was given', () => {
      const input = [photo('a'), photo('b')]
      const s = scores([
        ['a', 0.9],
        ['b', 0.1],
      ])
      const before = input.map((p) => p.id)
      applyFilter(input, 'review', s)
      // `Array.prototype.sort` sorts in place, so this is the regression that
      // would reorder the caller's list — and with it, every other view.
      expect(input.map((p) => p.id)).toEqual(before)
    })
  })
})

describe('groupPhotos', () => {
  it('preserves first-seen order rather than sorting', () => {
    const groups = groupPhotos([
      photo('a', { dateGroup: 'Today' }),
      photo('b', { dateGroup: 'Yesterday' }),
      photo('c', { dateGroup: 'Today' }),
    ])
    expect(groups.map((g) => g.date)).toEqual(['Today', 'Yesterday'])
    expect(groups[0]?.photos.map((p) => p.id)).toEqual(['a', 'c'])
  })
})

describe('safeFilename', () => {
  it('strips characters that would change where a file lands', () => {
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd')
  })

  it('replaces a backslash, which separates on one of the two platforms', () => {
    expect(safeFilename('..\\..\\windows\\system32')).toBe('.._.._windows_system32')
  })

  it('replaces every character Windows refuses', () => {
    // Not path separators, but still not allowed in a filename there. Half the
    // reason this function exists, and untested until now.
    expect(safeFilename('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h')
  })

  it('replaces control characters, which no filename may contain', () => {
    expect(safeFilename('a\u0000b\u001fc')).toBe('a_b_c')
  })

  it('keeps Unicode, because this is a blocklist and not an allowlist', () => {
    // The behaviour that would change if someone rewrote this the way the old
    // doc comment described. A user's own script and a coffee cup are theirs,
    // and turning them into underscores is worse than keeping them.
    expect(safeFilename('写真 2026 — 京都.jpg')).toBe('写真 2026 — 京都.jpg')
    expect(safeFilename('café ☕.png')).toBe('café ☕.png')
  })

  it('leaves a leading dot alone, which is only a traversal in company', () => {
    expect(safeFilename('.hidden')).toBe('.hidden')
  })

  it('falls back when nothing identifying survives', () => {
    expect(safeFilename('___')).toBe('download')
    expect(safeFilename('')).toBe('download')
  })

  it('treats a bare dot-dot as nothing identifying, which closes the traversal', () => {
    // `..` survives the pattern — `.` is a legal filename character — so the
    // fallback is what stops it, because there is nothing alphanumeric in the
    // name. Worth its own test: somebody tightening the pattern needs to know
    // which half is doing the work.
    expect(safeFilename('..')).toBe('download')
    expect(safeFilename('../..')).toBe('download')
  })
})
