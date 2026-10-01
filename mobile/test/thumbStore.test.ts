/**
 * The cache key, which is the one part of the store that is pure.
 *
 * The rest of `thumbStore.ts` is filesystem calls wrapped so that every failure
 * is a silent miss — deliberately, because a cache that throws is worse than no
 * cache. The side effect is that the whole module is invisible to a test
 * environment where the filesystem does not exist: nothing fails, so nothing is
 * asserted. This covers the piece that can be.
 *
 * The key is worth pinning because it is a *filename*. The desktop's version is
 * pipe-separated, which IndexedDB accepts and a filesystem does not — a `/` in
 * an asset id would silently become a directory, and the miss it caused would
 * look like a cache that never hits rather than a bug in this function.
 *
 * Mobile's own file, not a copy.
 */

import { cacheKey } from '../src/platform/thumbStore'

describe('cacheKey', () => {
  it('includes the scope, so two servers cannot collide', () => {
    // An Immich asset id is only unique within one server. Without the scope, a
    // photo from one server would be served the thumbnail of a different photo
    // on another — and it would look like a broken image, not like a cache bug.
    const a = cacheKey('server-a', 'small', 'abc')
    const b = cacheKey('server-b', 'small', 'abc')
    expect(a).not.toBe(b)
  })

  it('separates sizes, so a large thumbnail is not served as a small one', () => {
    expect(cacheKey('s', 'small', 'x')).not.toBe(cacheKey('s', 'large', 'x'))
  })

  it('is always a single, safe path component', () => {
    // What matters is that the key is one component that cannot climb out of
    // the cache directory. A `..` *substring* is harmless — `v1-s-small-.._etc`
    // is one name, not a parent reference — which is what the first version of
    // this test got wrong by asserting the stricter, meaningless thing.
    const hostile = [
      cacheKey('s', 'small', 'a/b'),
      cacheKey('a/b', 'small', 'c'),
      cacheKey('s', 'small', '../../etc/passwd'),
      cacheKey('s', 'small', '..\\..\\windows\\system32'),
    ]

    for (const key of hostile) {
      expect(key).not.toContain('/')
      expect(key).not.toContain('\\')
      expect(key).not.toBe('.')
      expect(key).not.toBe('..')
    }
  })

  it('is versioned, so a schema change can invalidate everything at once', () => {
    expect(cacheKey('s', 'small', 'x').startsWith('v1-')).toBe(true)
  })

  it('is stable for the same inputs', () => {
    expect(cacheKey('s', 'small', 'x')).toBe(cacheKey('s', 'small', 'x'))
  })
})
