/**
 * Breaking a date group into rows.
 *
 * `FlatList` cannot combine full-width section headers with `numColumns`, so
 * the grid is built by hand: photos are chunked into rows of three and a
 * `SectionList` renders the rows under a sticky header. That keeps the headers
 * the spec asks for and keeps the list virtualised by row rather than by photo.
 *
 * Pure, and separate from the screen, because the off-by-one it can get wrong —
 * a trailing row of fewer than three — is invisible until a library happens to
 * end on one.
 */

export const COLUMNS = 3

export function chunkRows<T>(items: readonly T[], size: number = COLUMNS): T[][] {
  if (size < 1) throw new Error('a row needs at least one column')

  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size))
  }
  return rows
}
