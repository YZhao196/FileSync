import { beforeEach, describe, expect, it } from 'vitest'
import { createMockBackends } from './mock'
import type { Backends } from './backends'

/**
 * Tests for the placeholder backend.
 *
 * It is not test scaffolding — it is what the app ships against when no server
 * exists, and the screens are only as verifiable as it is. The rename test
 * exists because the first implementation deleted the destination rather than
 * the source, so a rename left both names in place: a bug that looked like
 * success and was only caught by using the app.
 */

let backends: Backends

/**
 * The store is a module singleton with no reset, and tests in one file share
 * it. Folders are therefore named per run, so re-running the file (watch mode)
 * starts from a fresh name rather than colliding with its own leftovers.
 */
const run = Math.random().toString(36).slice(2, 8)
const folder = (name: string) => `/projects/${name}-${run}`

beforeEach(() => {
  backends = createMockBackends()
})

describe('mock files', () => {
  it('lists a folder with subfolders first', async () => {
    const entries = await backends.files.list('/projects/espnas')
    expect(entries[0]?.isFolder).toBe(true)
    expect(entries.map((e) => e.name)).toContain('README.md')
  })

  it('reports a file as previewable only when it can be rendered', async () => {
    const entries = await backends.files.list('/documents')
    const notes = entries.find((e) => e.name === 'Notes.md')
    const sheet = entries.find((e) => e.name === 'Budget 2026.xlsx')
    expect(notes?.previewable).toBe(true)
    expect(sheet?.previewable).toBe(false)
  })

  it('creates a folder and lists it', async () => {
    const path = folder('created')
    await backends.files.mkdir(path)
    const entries = await backends.files.list('/projects')
    expect(entries.map((e) => e.path)).toContain(path)
  })

  it('refuses to create a folder where something already exists', async () => {
    await expect(backends.files.mkdir('/projects')).rejects.toThrow(/already exists/)
  })

  it('renames rather than duplicating', async () => {
    const from = folder('rename-a')
    const to = folder('rename-b')
    await backends.files.mkdir(from)
    await backends.files.move(from, to)

    const paths = (await backends.files.list('/projects')).map((e) => e.path)
    expect(paths).toContain(to)
    expect(paths).not.toContain(from)
  })

  it("carries a folder's contents when it moves", async () => {
    const from = folder('move-src')
    const to = folder('move-dst')
    await backends.files.mkdir(from)
    await backends.files.mkdir(`${from}/inner`)
    await backends.files.move(from, to)

    const inner = await backends.files.list(to)
    expect(inner.map((e) => e.name)).toContain('inner')
    // And the old path is gone, contents included.
    expect(await backends.files.list(from)).toEqual([])
  })

  it('deletes a folder and everything inside it', async () => {
    const path = folder('deleted')
    await backends.files.mkdir(path)
    await backends.files.mkdir(`${path}/inner`)
    await backends.files.remove(path)

    const paths = (await backends.files.list('/projects')).map((e) => e.path)
    expect(paths).not.toContain(path)
  })

  it('builds a tree that includes a folder just created', async () => {
    const path = folder('in-tree')
    await backends.files.mkdir(path)
    const tree = await backends.files.tree()
    const projects = tree.find((n) => n.path === '/projects')
    expect(projects?.children?.map((c) => c.path)).toContain(path)
  })

  it('refuses a download for a folder', async () => {
    await expect(backends.files.download('/projects')).rejects.toThrow()
  })
})

describe('mock photos', () => {
  it('toggles a favourite and reflects it in the Favourites album', async () => {
    const photos = await backends.photos.list({ page: 1 })
    const target = photos.find((p) => !p.isFavourite)
    expect(target).toBeDefined()
    if (!target) return

    const albumBefore = (await backends.photos.albums()).find((a) => a.name === 'Favourites')
    await backends.photos.setFavourite(target.id, true)

    const updated = (await backends.photos.list({ page: 1 })).find((p) => p.id === target.id)
    expect(updated?.isFavourite).toBe(true)

    const albumAfter = (await backends.photos.albums()).find((a) => a.name === 'Favourites')
    expect(albumAfter?.count).toBe((albumBefore?.count ?? 0) + 1)
  })

  it('adds photos to an album and grows its count', async () => {
    const albums = await backends.photos.albums()
    const album = albums.find((a) => a.name === 'Experiments')
    const photos = await backends.photos.list({ page: 1 })
    const candidate = photos.find((p) => !p.isFavourite)
    expect(album).toBeDefined()
    expect(candidate).toBeDefined()
    if (!album || !candidate) return

    const before = (await backends.photos.albumAssets(album.id)).length
    await backends.photos.addToAlbum(album.id, [candidate.id])
    const after = await backends.photos.albumAssets(album.id)
    expect(after.length).toBe(before + 1)
    expect(after.map((p) => p.id)).toContain(candidate.id)
  })

  it('removes photos everywhere, not just from the timeline', async () => {
    const albums = await backends.photos.albums()
    const album = albums.find((a) => a.name === 'Summer')
    expect(album).toBeDefined()
    if (!album) return

    const inAlbum = await backends.photos.albumAssets(album.id)
    const victim = inAlbum[0]
    expect(victim).toBeDefined()
    if (!victim) return

    await backends.photos.remove([victim.id])

    expect((await backends.photos.list({ page: 1 })).map((p) => p.id)).not.toContain(victim.id)
    expect((await backends.photos.albumAssets(album.id)).map((p) => p.id)).not.toContain(victim.id)
  })

  it('returns originals as renderable bytes, not an empty blob', async () => {
    const photos = await backends.photos.list({ page: 1 })
    const id = photos[0]?.id
    expect(id).toBeDefined()
    if (!id) return
    const blob = await backends.photos.original(id)
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe('image/svg+xml')
  })

  it('searches case-insensitively and returns nothing for an empty query', async () => {
    expect((await backends.photos.search('img_4001')).map((p) => p.name)).toContain('IMG_4001.jpg')
    expect(await backends.photos.search('   ')).toEqual([])
  })
})
