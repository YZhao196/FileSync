import { describe, expect, it } from 'vitest'
import { joinPath, parentOf, sameRoot } from './paths'

/**
 * These two functions decide where a renamed or moved file ends up, and they had
 * no test.
 *
 * That is the gap worth closing rather than a coverage number: `rename` is
 * `joinPath(parentOf(path), newName)` in the shared client, so a mistake here
 * does not throw — it moves somebody's file to a path they did not ask for, and
 * the server accepts it because the path is well-formed. Silent and destructive
 * is the combination that deserves tests.
 *
 * A synced file, so mobile runs these too — see `scripts/sync-core.mjs`.
 */
describe('parentOf', () => {
  it('finds the containing folder', () => {
    expect(parentOf('/srv/cloud/projects/plan.md')).toBe('/srv/cloud/projects')
  })

  it('returns the root for something directly inside it', () => {
    expect(parentOf('/plan.md')).toBe('/')
  })

  it('returns the root for the root', () => {
    expect(parentOf('/')).toBe('/')
    expect(parentOf('')).toBe('/')
  })

  it('ignores a trailing slash rather than treating it as a level', () => {
    // A folder path arrives with and without one depending on where it came
    // from, and a parent computed from the slash-bearing form would be one
    // level too high.
    expect(parentOf('/srv/cloud/')).toBe('/srv')
  })

  it('normalises a relative path to an absolute one', () => {
    // WebDAV paths are absolute, so a relative one is already wrong — this at
    // least makes it wrong in a way that is visible rather than half-relative.
    expect(parentOf('a/b')).toBe('/a')
  })
})

describe('joinPath', () => {
  it('appends to a folder', () => {
    expect(joinPath('/srv/cloud/projects', 'plan.md')).toBe('/srv/cloud/projects/plan.md')
  })

  it('does not double the root slash', () => {
    expect(joinPath('/', 'plan.md')).toBe('/plan.md')
  })

  it('tolerates a trailing slash on the parent', () => {
    expect(joinPath('/srv/cloud/', 'plan.md')).toBe('/srv/cloud/plan.md')
  })

  it('treats an empty parent as the root', () => {
    expect(joinPath('', 'plan.md')).toBe('/plan.md')
  })

  it('round-trips a rename', () => {
    // The operation the file browser actually performs.
    const original = '/srv/cloud/projects/plan.md'
    const renamed = joinPath(parentOf(original), 'roadmap.md')
    expect(renamed).toBe('/srv/cloud/projects/roadmap.md')
  })

  it('keeps a rename inside its own folder', () => {
    // The property that matters: a rename never promotes a file to a different
    // directory, whatever the name contains. A name is a name.
    const original = '/srv/cloud/projects/plan.md'
    expect(parentOf(joinPath(parentOf(original), 'notes.md'))).toBe(parentOf(original))
  })
})

describe('sameRoot', () => {
  it('calls two folders under one parent the same disk', () => {
    expect(sameRoot('/srv/photos', '/srv/cloud')).toBe(true)
  })

  it('calls two folders under different parents different disks', () => {
    expect(sameRoot('/srv/photos', '/mnt/cloud')).toBe(false)
  })

  it('calls top-level folders the same, which is the documented crudeness', () => {
    // `parentOf` is `/` for both, so this says "same disk" for two directories
    // that could be separate mounts. The doc comment calls the heuristic crude
    // and says it is advice rather than a gate, and this is what crude means —
    // pinned so that a future tightening is a deliberate change with a test to
    // update rather than a silent improvement.
    expect(sameRoot('/photos', '/cloud')).toBe(true)
  })

  it('says no when either side is empty', () => {
    expect(sameRoot('', '/srv/cloud')).toBe(false)
    expect(sameRoot('/srv/photos', '')).toBe(false)
    expect(sameRoot('', '')).toBe(false)
  })
})
