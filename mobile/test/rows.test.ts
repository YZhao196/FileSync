/**
 * Row chunking, which is small enough to look obviously right and has one
 * case that is not: a library whose last row is short.
 *
 * Mobile's own file — `scripts/sync-core.mjs` governs `src/core` and `src/lib`
 * only.
 */

import { chunkRows, COLUMNS } from '../src/screens/photos/rows'

describe('chunkRows', () => {
  it('splits into rows of the column count', () => {
    expect(chunkRows([1, 2, 3, 4, 5, 6])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
  })

  it('keeps a short final row rather than padding or dropping it', () => {
    // The bug this guards: an implementation that fills rows by index and
    // discards a trailing partial one loses photos from the end of every
    // group, which looks like a paging bug and is not.
    expect(chunkRows([1, 2, 3, 4])).toEqual([[1, 2, 3], [4]])
  })

  it('handles fewer items than a full row', () => {
    expect(chunkRows([1])).toEqual([[1]])
  })

  it('returns nothing for nothing', () => {
    expect(chunkRows([])).toEqual([])
  })

  it('defaults to the three columns the spec asks for', () => {
    expect(COLUMNS).toBe(3)
    expect(chunkRows([1, 2, 3, 4])[1]).toHaveLength(1)
  })

  it('rejects a row size that could not terminate', () => {
    expect(() => chunkRows([1, 2], 0)).toThrow()
  })
})
