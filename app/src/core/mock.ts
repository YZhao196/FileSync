/**
 * Mock backend — the development test double.
 *
 * Development builds run against this so every screen can be built and reviewed
 * with no server anywhere. A **shipped build never does**: `createBackends`
 * selects it only when `import.meta.env.DEV`, which is statically false in
 * production, so there is no path by which a user sees fabricated data. It is a
 * test double, not a product feature.
 *
 * It is a real, mutable, in-memory backend rather than a set of canned
 * responses: favouriting, deleting, adding to an album, creating a folder and
 * downloading all change this store and are visible afterwards. That is what
 * makes "the front end works" a checkable claim without a server — a mock that
 * returned fixed data would leave every button untested.
 *
 * Reset by reloading the page. Nothing here touches the network or the disk.
 */

import type { Backends, FileBackend, PhotoBackend, ServerBackend } from './backends'
import type {
  Album,
  AlbumSuggestion,
  DecisionStatus,
  FileEntry,
  Gradient,
  Photo,
  PhotoId,
  PhotoPage,
  PhotoScore,
  ScoreResult,
  ServerStatus,
  TreeNode,
} from './types'

const GRADIENTS: Gradient[] = [
  ['#ead8bc', '#c9a87a'],
  ['#bcd8ea', '#7aaac9'],
  ['#d8eabc', '#a8c97a'],
  ['#eabcd8', '#c97aac'],
  ['#c8d4ea', '#789ec9'],
  ['#ead8c8', '#c9b07a'],
  ['#d8eac8', '#a0c97a'],
  ['#eac8d4', '#c97aa0'],
  ['#dcd4ea', '#9890c9'],
  ['#d8ead8', '#7ac992'],
  ['#eadada', '#c99090'],
  ['#daeaea', '#90c9c8'],
  ['#eae8d8', '#c9be7a'],
  ['#d4dcea', '#7898c9'],
  ['#e0d4ea', '#a07ac9'],
  ['#d4ead8', '#7ac990'],
]

const FAVOURITES = new Set(['m0', 'm3', 'm8', 'm15', 'm22', 'm29'])
const PHOTO_COUNT = 36

function dateGroupFor(i: number): string {
  if (i < 4) return 'Today'
  if (i < 10) return 'Yesterday'
  if (i < 26) return 'September 2026'
  return 'August 2026'
}

function takenAtFor(i: number): string {
  const daysAgo = i < 4 ? 0 : i < 10 ? 1 : i < 26 ? 20 + (i % 6) : 45 + (i % 10)
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(9 + (i % 10), (i * 7) % 60, 0, 0)
  return d.toISOString()
}

/* ── The mutable store ─────────────────────────────────────────────────── */

const ALBUM_FAVOURITES = 'a1'

interface MockAlbum {
  id: string
  name: string
  gradient: Gradient
  members: Set<PhotoId>
}

/** One node in the placeholder filesystem. Folders carry no size or type. */
interface MockFile {
  isFolder: boolean
  sizeBytes: number
  mime: string
  modified: Date
}

const store = {
  photos: [] as Photo[],

  albums: [
    { id: ALBUM_FAVOURITES, name: 'Favourites', gradient: ['#f0c060', '#e89020'], members: new Set() },
    { id: 'a2', name: 'Family Trip 2026', gradient: ['#60a8f0', '#2080e8'], members: new Set() },
    { id: 'a3', name: 'Architecture', gradient: ['#a060f0', '#7020e8'], members: new Set() },
    { id: 'a4', name: 'Work Events', gradient: ['#60f0a8', '#20c870'], members: new Set() },
    { id: 'a5', name: 'Summer', gradient: ['#f08060', '#e84020'], members: new Set() },
    { id: 'a6', name: 'Experiments', gradient: ['#60f0e8', '#20c8d0'], members: new Set() },
  ] as MockAlbum[],

  /** path → node. Folders have isFolder and no size. */
  files: new Map<string, MockFile>(),
}

// Seed photos.
for (let i = 0; i < PHOTO_COUNT; i++) {
  const isVideo = i % 11 === 7
  const id = `m${i}`
  store.photos.push({
    id,
    name: `IMG_${4000 + i}.${isVideo ? 'mp4' : 'jpg'}`,
    dateGroup: dateGroupFor(i),
    takenAt: takenAtFor(i),
    isVideo,
    isFavourite: FAVOURITES.has(id),
    gradient: GRADIENTS[i % GRADIENTS.length],
  })
}

// Seed album membership — favourites mirror the flag, the rest are spread out.
store.photos.forEach((p, i) => {
  if (p.isFavourite) store.albums[0]?.members.add(p.id)
  if (i % 3 === 0) store.albums[1]?.members.add(p.id)
  if (i % 4 === 1) store.albums[2]?.members.add(p.id)
  if (i % 7 === 2) store.albums[3]?.members.add(p.id)
  if (i % 5 === 3) store.albums[4]?.members.add(p.id)
  if (i % 11 === 5) store.albums[5]?.members.add(p.id)
})

// Seed files.
const now = Date.now()
function addFile(path: string, sizeBytes: number, mime: string, daysAgo = 3) {
  store.files.set(path, {
    isFolder: false,
    sizeBytes,
    mime,
    modified: new Date(now - daysAgo * 86_400_000),
  })
}
function addFolder(path: string, daysAgo = 10) {
  store.files.set(path, { isFolder: true, sizeBytes: 0, mime: '', modified: new Date(now - daysAgo * 86_400_000) })
}

for (const folder of ['/projects', '/projects/espnas', '/projects/espnas/src', '/projects/website', '/documents', '/photos']) {
  addFolder(folder)
}
addFile('/projects/espnas/README.md', 2048, 'text/markdown', 2)
addFile('/projects/espnas/package.json', 1024, 'application/json', 3)
addFile('/projects/espnas/cover.png', 1_258_291, 'image/png', 3)
addFile('/projects/espnas/src/index.ts', 4096, 'text/plain', 4)
addFile('/documents/Budget 2026.xlsx', 43_008, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 9)
addFile('/documents/Notes.md', 8192, 'text/markdown', 5)
addFile('/photos/beach.jpg', 2_411_724, 'image/jpeg', 7)

const GIB = 1024 ** 3

const MOCK_SERVER_STATUS: ServerStatus = {
  reachable: true,
  services: [
    { name: 'Immich', state: 'running' },
    { name: 'Nextcloud', state: 'running' },
    { name: 'MariaDB', state: 'running' },
    { name: 'Redis', state: 'running' },
  ],
  drives: [
    { label: 'Photos drive', usedBytes: 240 * GIB, totalBytes: 1024 * GIB },
    { label: 'Cloud drive', usedBytes: 86 * GIB, totalBytes: 512 * GIB },
  ],
  backup: {
    lastRunAt: '2026-09-12T03:14:00',
    lastRunOk: true,
    nextRunAt: '2026-09-13T03:14:00',
    snapshotCount: 47,
    cloudTotalBytes: 23 * GIB,
  },
  network: {
    tailscaleConnected: true,
    deviceName: 'espnas',
    tailscaleIp: '100.64.1.1',
  },
  uptimeSeconds: 23 * 86400 + 14 * 3600,
  lastBootAt: '2026-08-18T00:00:00',
}

/** Stands in for network latency so loading states are real, not theoretical. */
const delay = (ms = 260) => new Promise<void>((r) => setTimeout(r, ms))

function albumCount(a: MockAlbum): number {
  return a.id === ALBUM_FAVOURITES ? store.photos.filter((p) => p.isFavourite).length : a.members.size
}

function toAlbum(a: MockAlbum): Album {
  return { id: a.id, name: a.name, count: albumCount(a), gradient: a.gradient }
}

/**
 * A real, renderable file standing in for the original.
 *
 * An SVG rather than random bytes, because it is text: the preview renders,
 * the bytes are tiny, and there is no pretence of being the actual JPEG.
 */
function placeholderImage(photo: Photo): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${photo.gradient[0]}"/>
    <stop offset="1" stop-color="${photo.gradient[1]}"/>
  </linearGradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="400" y="300" font-family="monospace" font-size="26" fill="#00000066"
        text-anchor="middle">${photo.name}</text>
</svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

/* ── Photos ────────────────────────────────────────────────────────────── */

/** Deliberately below the live page size — see `list` below. Exported so the
 *  test can assert against the real number rather than a copy of it. */
export const MOCK_PHOTO_PAGE_SIZE = 24

class MockPhotoBackend implements PhotoBackend {
  /** Its own scope, so a mock cache never collides with a real server's. */
  readonly cacheScope = 'mock'

  /**
   * Paged, at a size chosen to be *smaller* than the placeholder library.
   *
   * The live client asks for 100 at a time; with 36 sample photos that would
   * mean one page and `hasMore: false` for ever, so the infinite-scroll path
   * would never once execute in a browser. 24 makes the second page real,
   * which is the only way this code is checkable without a server.
   */
  async list(opts: { page: number; from?: Date; to?: Date }): Promise<PhotoPage> {
    await delay()
    const start = (Math.max(1, opts.page) - 1) * MOCK_PHOTO_PAGE_SIZE
    const slice = store.photos.slice(start, start + MOCK_PHOTO_PAGE_SIZE)
    return {
      photos: slice.map((p) => ({ ...p })),
      hasMore: start + slice.length < store.photos.length,
    }
  }

  async get(id: PhotoId): Promise<Photo> {
    await delay(60)
    const p = store.photos.find((x) => x.id === id)
    if (!p) throw new Error(`No photo ${id}`)
    return { ...p }
  }

  async thumb(): Promise<Blob | null> {
    // No thumbnails behind mock data — the tile keeps its gradient.
    return null
  }

  async search(query: string): Promise<Photo[]> {
    await delay()
    const q = query.trim().toLowerCase()
    if (!q) return []
    return store.photos.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ ...p }))
  }

  async albums(): Promise<Album[]> {
    await delay()
    return store.albums.map(toAlbum)
  }

  async albumAssets(albumId: string): Promise<Photo[]> {
    await delay()
    const album = store.albums.find((a) => a.id === albumId)
    if (!album) throw new Error(`No album ${albumId}`)
    if (album.id === ALBUM_FAVOURITES) {
      return store.photos.filter((p) => p.isFavourite).map((p) => ({ ...p }))
    }
    return store.photos.filter((p) => album.members.has(p.id)).map((p) => ({ ...p }))
  }

  async original(id: PhotoId): Promise<Blob> {
    await delay(120)
    const p = store.photos.find((x) => x.id === id)
    if (!p) throw new Error(`No photo ${id}`)
    return placeholderImage(p)
  }

  async setFavourite(id: PhotoId, favourite: boolean): Promise<void> {
    await delay(90)
    const p = store.photos.find((x) => x.id === id)
    if (!p) throw new Error(`No photo ${id}`)
    p.isFavourite = favourite
    const favAlbum = store.albums[0]
    if (favAlbum) {
      if (favourite) favAlbum.members.add(id)
      else favAlbum.members.delete(id)
    }
  }

  async remove(ids: PhotoId[]): Promise<void> {
    await delay(160)
    const gone = new Set(ids)
    store.photos = store.photos.filter((p) => !gone.has(p.id))
    for (const a of store.albums) for (const id of gone) a.members.delete(id)
  }

  async addToAlbum(albumId: string, ids: PhotoId[]): Promise<void> {
    await delay(120)
    const album = store.albums.find((a) => a.id === albumId)
    if (!album) throw new Error(`No album ${albumId}`)
    for (const id of ids) album.members.add(id)
  }

  async share(ids: PhotoId[]): Promise<string> {
    await delay(200)
    // A real server returns a link it hosts. Nothing is hosted here, so the
    // returned string says so rather than pretending to be a URL.
    return `placeholder://${ids.length} item${ids.length === 1 ? '' : 's'} — no server to host a share`
  }
}

/* ── Files ─────────────────────────────────────────────────────────────── */

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function normalize(path: string): string {
  return `/${segments(path).join('/')}`
}

function parentOf(path: string): string {
  const parts = segments(path)
  parts.pop()
  return `/${parts.join('/')}`
}

function entryFor(path: string, node: MockFile): FileEntry {
  const name = segments(path).pop() ?? path
  const typeLabel = node.isFolder
    ? 'Folder'
    : node.mime.split('/').pop()?.toUpperCase().slice(0, 12) || 'File'
  return {
    name,
    path,
    isFolder: node.isFolder,
    sizeBytes: node.sizeBytes,
    sizeLabel: node.isFolder ? '—' : humanBytes(node.sizeBytes),
    typeLabel,
    modifiedLabel: node.modified.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    mime: node.mime,
    previewable: isPreviewable(node.mime),
  }
}

/** Images render inline; text is fetched and shown as text. Everything else
 *  gets no preview rather than a download-in-disguise. */
export function isPreviewable(mime: string | undefined): boolean {
  if (!mime) return false
  return mime.startsWith('image/') || mime.startsWith('text/') || mime === 'application/json'
}

class MockFileBackend implements FileBackend {
  async list(path: string): Promise<FileEntry[]> {
    await delay(180)
    const dir = normalize(path)
    const out: FileEntry[] = []
    for (const [p, node] of store.files) {
      if (p === dir) continue
      if (parentOf(p) !== dir) continue
      out.push(entryFor(p, node))
    }
    // Folders first, then by name — the order every file manager uses.
    return out.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1))
  }

  async tree(): Promise<TreeNode[]> {
    await delay(180)
    const root: TreeNode[] = []
    const byPath = new Map<string, TreeNode>()
    const folders = [...store.files.entries()]
      .filter(([, n]) => n.isFolder)
      .map(([p]) => p)
      .sort((a, b) => a.split('/').length - b.split('/').length)

    for (const folder of folders) {
      const name = segments(folder).pop() ?? folder
      const node: TreeNode = { id: folder, name, path: folder, isFolder: true, children: [] }
      byPath.set(folder, node)
      const parent = byPath.get(parentOf(folder))
      if (parent) parent.children?.push(node)
      else root.push(node)
    }

    // Files hang off their folder; anything at the root is shown too.
    for (const [p, n] of store.files) {
      if (n.isFolder) continue
      const name = segments(p).pop() ?? p
      const node: TreeNode = { id: p, name, path: p, isFolder: false }
      const parent = byPath.get(parentOf(p))
      if (parent) parent.children?.push(node)
      else root.push(node)
    }
    return root
  }

  async download(path: string): Promise<Blob> {
    await delay(140)
    const node = store.files.get(normalize(path))
    if (!node || node.isFolder) throw new Error(`No file at ${path}`)
    if (node.mime.startsWith('image/')) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
  <rect width="600" height="400" fill="#c8d4ea"/>
  <text x="300" y="205" font-family="monospace" font-size="20" fill="#00000066"
        text-anchor="middle">${segments(path).pop()}</text>
</svg>`
      return new Blob([svg], { type: 'image/svg+xml' })
    }
    if (isPreviewable(node.mime)) {
      return new Blob([`Placeholder contents for ${path}.\n\nNo server is connected — see for-human.md.\n`], {
        type: node.mime,
      })
    }
    return new Blob([`Placeholder binary (${node.sizeBytes} bytes) for ${path}.`], { type: 'application/octet-stream' })
  }

  async move(from: string, to: string): Promise<void> {
    await delay(150)
    const src = normalize(from)
    const dst = normalize(to)
    if (!store.files.has(src)) throw new Error(`No file at ${from}`)
    if (store.files.has(dst)) throw new Error(`Something already exists at ${to}`)

    // Collect first, then delete, then insert. The first version deleted the
    // *destination* paths instead of the source ones, so a rename left both
    // names in place — a rename that duplicated looked like it had worked.
    const moved: Array<{ from: string; to: string; node: MockFile }> = []
    for (const [path, node] of store.files) {
      if (path === src) moved.push({ from: path, to: dst, node })
      // Moving a folder carries its contents, as a real filesystem would.
      else if (path.startsWith(`${src}/`)) moved.push({ from: path, to: dst + path.slice(src.length), node })
    }

    for (const m of moved) store.files.delete(m.from)
    for (const m of moved) store.files.set(m.to, m.node)
  }

  async mkdir(path: string): Promise<void> {
    await delay(130)
    const dir = normalize(path)
    if (store.files.has(dir)) throw new Error(`Something already exists at ${path}`)
    if (!store.files.get(parentOf(dir))?.isFolder) throw new Error(`No such folder: ${parentOf(dir)}`)
    store.files.set(dir, { isFolder: true, sizeBytes: 0, mime: '', modified: new Date() })
  }

  async remove(path: string): Promise<void> {
    await delay(150)
    const target = normalize(path)
    if (!store.files.has(target)) throw new Error(`No file at ${path}`)
    store.files.delete(target)
    for (const p of [...store.files.keys()]) {
      if (p.startsWith(`${target}/`)) store.files.delete(p)
    }
  }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/* ── Server ────────────────────────────────────────────────────────────── */

class MockServerBackend implements ServerBackend {
  /**
   * Captions already "on disk". A real Map rather than a canned response, for
   * the reason the top of this file gives: with a fixed one, clearing the cache
   * and re-scoring would look identical, and the button would be untested.
   */
  private readonly captions = new Map<PhotoId, string>()

  async status(): Promise<ServerStatus> {
    await delay(220)
    return structuredClone(MOCK_SERVER_STATUS)
  }

  async runBackup(): Promise<void> {
    await delay(3000)
  }

  async restartService(name: string): Promise<void> {
    await delay(900)
    void name
  }

  async decisionStatus(): Promise<DecisionStatus> {
    await delay(120)
    return {
      available: true,
      vision: 'ok',
      decision: 'ok',
      model: 'moondream',
      captioned: this.captions.size,
    }
  }

  async scorePhotos(ids: PhotoId[]): Promise<ScoreResult> {
    await delay(400)
    const scores: PhotoScore[] = []
    const failed: Array<{ id: PhotoId; reason: string }> = []

    for (const id of ids) {
      // Derived from the id rather than random, so the queue orders the same way
      // on every reload and a test can assert it. Roughly one id in eleven
      // fails, so the per-photo error path is reachable in a browser.
      const h = hash(id)
      if (h % 11 === 0) {
        failed.push({ id, reason: 'the vision model timed out' })
        continue
      }
      const caption = this.captions.get(id) ?? CAPTIONS[h % CAPTIONS.length]
      this.captions.set(id, caption)
      scores.push({ id, score: (h % 1000) / 1000, caption })
    }

    return { ok: true, scores, pending: 0, failed }
  }

  async suggestAlbums(ids: PhotoId[], albums: string[]): Promise<AlbumSuggestion[]> {
    await delay(260)
    if (!albums.length) return []
    return ids.map((id) => {
      const h = hash(id)
      return { id, album: albums[h % albums.length], confidence: 0.5 + (h % 500) / 1000 }
    })
  }

  async clearCaptionCache(): Promise<number> {
    await delay(90)
    const cleared = this.captions.size
    this.captions.clear()
    return cleared
  }
}

/** FNV-1a, so the mock is deterministic. Real scores come from the model. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Descriptions in the shape the vision model returns: what is in the frame, not
 * how good a photograph it is. The cull queue's whole honesty problem is that
 * those are different things, so the placeholder data should not paper over it.
 */
const CAPTIONS = [
  'a blurry photo of a dog at night',
  'a person holding a birthday cake in a dim room',
  'a close-up of a plate of food on a wooden table',
  'a wide shot of a beach at sunset',
  'a screenshot of a computer screen showing text',
  'a dark photo of a street with streetlights',
  'two people standing in front of a building',
  'an out-of-focus photo of a cat on a sofa',
]

export function createMockBackends(): Backends {
  return {
    photos: new MockPhotoBackend(),
    files: new MockFileBackend(),
    server: new MockServerBackend(),
  }
}
