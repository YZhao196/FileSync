/**
 * Live backends. Arm's-length HTTP clients for Immich, Nextcloud and the host
 * agent — no vendor code is imported, vendored or linked (PLAN.md §13.4).
 *
 * Unverified against a real server: none exists yet. See for-human.md for the
 * two things already known to bite — the `all` permission on an Immich API key,
 * and the `x-api-key` header rather than `Authorization: Bearer`.
 */

import { nativeFetch, type NativeResponse } from '../native/bridge'
import type { Backends, FileBackend, PhotoBackend, ServerBackend } from './backends'
import type {
  Album,
  Connection,
  Credentials,
  FileEntry,
  Photo,
  PhotoId,
  ServerStatus,
  TreeNode,
} from './types'

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function req(url: string, init: RequestInit = {}): Promise<NativeResponse> {
  const res = await nativeFetch(url, {
    method: (init.method as string | undefined) ?? 'GET',
    headers: init.headers as Record<string, string> | undefined,
    body: init.body as string | undefined,
  })
  if (!res.ok) throw new HttpError(`${res.status} ${res.statusText} — ${url}`, res.status)
  return res
}

/* ── Immich ────────────────────────────────────────────────────────────── */

interface ImmichAsset {
  id: string
  originalFileName?: string
  fileCreatedAt?: string
  type?: string
  isFavorite?: boolean
}

class ImmichPhotoBackend implements PhotoBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Asset ids are per-server, so the cache is keyed by where they came from.
   *
   * A getter rather than a field: field initialisers run before constructor
   * parameter properties are assigned, so a field would read `undefined`.
   */
  get cacheScope(): string {
    return this.baseUrl
  }

  private get headers(): HeadersInit {
    return { 'x-api-key': this.apiKey, 'content-type': 'application/json' }
  }

  async list(opts: { page: number; from?: Date; to?: Date }): Promise<Photo[]> {
    return this.searchMetadata({ page: opts.page, from: opts.from, to: opts.to })
  }

  /**
   * `POST /api/search/metadata` is the endpoint behind the timeline. Immich
   * does the paging and filtering; the client only renders what comes back
   * (PLAN.md §11 — "server-side ML is free via API").
   */
  private async searchMetadata(opts: {
    page?: number
    size?: number
    from?: Date
    to?: Date
  }): Promise<Photo[]> {
    const body: Record<string, unknown> = {
      page: opts.page ?? 1,
      size: opts.size ?? 100,
    }
    if (opts.from) body.takenAfter = opts.from.toISOString()
    if (opts.to) body.takenBefore = opts.to.toISOString()

    const res = await req(`${this.baseUrl}/api/search/metadata`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { assets?: { items?: ImmichAsset[] } }
    return (json.assets?.items ?? []).map(toPhoto)
  }

  async get(id: PhotoId): Promise<Photo> {
    const res = await req(`${this.baseUrl}/api/assets/${id}`, { headers: this.headers })
    return toPhoto((await res.json()) as ImmichAsset)
  }

  /**
   * Immich's thumbnail endpoint authenticates with `x-api-key` and offers no
   * query-parameter equivalent, so the bytes are fetched here and handed back
   * for the caller to turn into an object URL.
   *
   * `thumbnail` is the small cached render, `preview` the large one. Both are
   * pre-generated — never resized on request (PLAN.md §11).
   */
  async thumb(id: PhotoId, size: 'small' | 'large'): Promise<Blob | null> {
    const px = size === 'small' ? 'thumbnail' : 'preview'
    try {
      const res = await req(`${this.baseUrl}/api/assets/${id}/${px}?size=${size}`, {
        headers: { 'x-api-key': this.apiKey },
      })
      return await res.blob()
    } catch {
      // A missing thumbnail is not an error worth surfacing — the tile falls
      // back to its gradient, which is what the user sees anyway.
      return null
    }
  }

  async search(query: string): Promise<Photo[]> {
    const res = await req(`${this.baseUrl}/api/search/smart`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ query }),
    })
    const json = (await res.json()) as { assets?: { items?: ImmichAsset[] } }
    return (json.assets?.items ?? []).map(toPhoto)
  }

  async albums(): Promise<Album[]> {
    const res = await req(`${this.baseUrl}/api/albums`, { headers: this.headers })
    const json = (await res.json()) as Array<{
      id: string
      albumName: string
      assetCount?: number
    }>
    return json.map((a) => ({
      id: a.id,
      name: a.albumName,
      count: a.assetCount ?? 0,
      gradient: ['#c8d4ea', '#789ec9'] as [string, string],
    }))
  }

  async albumAssets(albumId: string): Promise<Photo[]> {
    const res = await req(`${this.baseUrl}/api/albums/${albumId}`, { headers: this.headers })
    const json = (await res.json()) as { assets?: ImmichAsset[] }
    return (json.assets ?? []).map(toPhoto)
  }

  async original(id: PhotoId): Promise<Blob> {
    const res = await req(`${this.baseUrl}/api/assets/${id}/original`, {
      headers: { 'x-api-key': this.apiKey },
    })
    return res.blob()
  }

  async setFavourite(id: PhotoId, favourite: boolean): Promise<void> {
    await req(`${this.baseUrl}/api/assets/${id}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ isFavorite: favourite }),
    })
  }

  /**
   * Deletes go to Immich's trash, not straight to gone — `force: false` is the
   * point. Deletion is recoverable for the retention window, which is what
   * PLAN.md §10 asks for: the app must not be the thing that destroys data.
   */
  async remove(ids: PhotoId[]): Promise<void> {
    await req(`${this.baseUrl}/api/assets`, {
      method: 'DELETE',
      headers: this.headers,
      body: JSON.stringify({ ids, force: false }),
    })
  }

  async addToAlbum(albumId: string, ids: PhotoId[]): Promise<void> {
    await req(`${this.baseUrl}/api/albums/${albumId}/assets`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ ids }),
    })
  }

  async share(ids: PhotoId[]): Promise<string> {
    const res = await req(`${this.baseUrl}/api/shared-links`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        type: ids.length === 1 ? 'INDIVIDUAL' : 'ALBUM',
        assetIds: ids,
      }),
    })
    const json = (await res.json()) as { key?: string }
    if (!json.key) throw new Error('Immich returned no share key')
    return `${this.baseUrl}/share/${json.key}`
  }
}

function toPhoto(a: ImmichAsset): Photo {
  const taken = a.fileCreatedAt ?? null
  return {
    id: a.id,
    name: a.originalFileName ?? a.id,
    dateGroup: taken ? formatGroup(taken) : 'Unknown',
    takenAt: taken,
    isVideo: a.type === 'VIDEO',
    isFavourite: a.isFavorite ?? false,
    gradient: ['#d8eac8', '#a0c97a'],
  }
}

function formatGroup(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dayMs = 86_400_000
  if (d >= startOfToday) return 'Today'
  if (d >= new Date(startOfToday.getTime() - dayMs)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/* ── Nextcloud (WebDAV) ────────────────────────────────────────────────── */

class NextcloudFileBackend implements FileBackend {
  private readonly root: string

  constructor(
    baseUrl: string,
    private readonly user: string,
    private readonly appPassword: string,
  ) {
    this.root = `${baseUrl.replace(/\/$/, '')}/remote.php/dav/files/${encodeURIComponent(user)}`
  }

  private get auth(): string {
    return `Basic ${btoa(`${this.user}:${this.appPassword}`)}`
  }

  private get headers(): HeadersInit {
    return { authorization: this.auth, depth: '1' }
  }

  async list(path: string): Promise<FileEntry[]> {
    const url = this.root + encodePath(path)
    const res = await req(url, { method: 'PROPFIND', headers: this.headers })
    // The href to compare against is the URL we asked for, server-absolute.
    return parseMultiStatus(await res.text(), path, new URL(url).pathname)
  }

  async tree(): Promise<TreeNode[]> {
    // WebDAV has no tree primitive; the browser expands on demand via list().
    return listToNodes(await this.list('/'))
  }

  async download(path: string): Promise<Blob> {
    const res = await req(this.root + encodePath(path), { headers: { authorization: this.auth } })
    return res.blob()
  }

  /**
   * MOVE does rename and relocate in one verb — there is no separate rename in
   * WebDAV, and a rename is just a move within the same collection.
   *
   * `Destination` must be an absolute URL, and `Overwrite: F` makes a collision
   * fail rather than silently replace the target.
   */
  async move(from: string, to: string): Promise<void> {
    await req(this.root + encodePath(from), {
      method: 'MOVE',
      headers: {
        authorization: this.auth,
        destination: this.root + encodePath(to),
        overwrite: 'F',
      },
    })
  }

  async mkdir(path: string): Promise<void> {
    await req(this.root + encodePath(path), {
      method: 'MKCOL',
      headers: { authorization: this.auth },
    })
  }

  async remove(path: string): Promise<void> {
    await req(this.root + encodePath(path), {
      method: 'DELETE',
      headers: { authorization: this.auth },
    })
  }
}

function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/**
 * Exported for testing — WebDAV XML is the fiddliest part of this file.
 *
 * `selfHref` is the server-absolute path that was requested. PROPFIND Depth:1
 * returns the collection itself alongside its children, and the hrefs are
 * server-absolute while `parentPath` is app-relative, so the self entry can only
 * be identified by comparing against the request path.
 */
export function parseMultiStatus(xml: string, parentPath: string, selfHref = ''): FileEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const out: FileEntry[] = []
  const selfPath = decodeURIComponent(selfHref).replace(/\/+$/, '')

  for (const resp of Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))) {
    const href = resp.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? ''
    const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '')
    if (!name) continue

    if (selfPath && decodeURIComponent(href).replace(/\/+$/, '') === selfPath) continue

    const isFolder = resp.getElementsByTagNameNS('DAV:', 'collection').length > 0
    const sizeBytes = Number(resp.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0)
    const modified = resp.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent ?? ''
    const mime = resp.getElementsByTagNameNS('DAV:', 'getcontenttype')[0]?.textContent ?? ''

    out.push({
      name,
      path: `${parentPath === '/' ? '' : parentPath}/${name}`,
      isFolder,
      sizeBytes,
      sizeLabel: isFolder ? '—' : humanBytes(sizeBytes),
      typeLabel: isFolder ? 'Folder' : mime.split('/').pop()?.toUpperCase() || 'File',
      modifiedLabel: modified ? new Date(modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
      mime: mime || undefined,
      previewable: isPreviewable(mime),
    })
  }
  return out
}

/** Kept local rather than imported from mock.ts — the live client must not
 *  depend on the placeholder one. Mirrors the same rule. */
function isPreviewable(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('text/') || mime === 'application/json'
}

function listToNodes(entries: FileEntry[]): TreeNode[] {
  return entries.map((e) => ({ id: e.path, name: e.name, path: e.path, isFolder: e.isFolder }))
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/* ── Host agent ────────────────────────────────────────────────────────── */

/**
 * Contract the host agent must serve. Nothing implements it yet — the agent is
 * the piece that makes the status panel possible, and it is the first thing
 * for-human.md asks to be deployed.
 *
 *   GET  /api/status                 -> ServerStatus
 *   POST /api/backup                 -> 202
 *   POST /api/services/:name/restart -> 202
 */
class AgentServerBackend implements ServerBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get headers(): HeadersInit {
    return { authorization: `Bearer ${this.token}` }
  }

  async status(): Promise<ServerStatus> {
    const res = await req(`${this.baseUrl}/api/status`, { headers: this.headers })
    return (await res.json()) as ServerStatus
  }

  async runBackup(): Promise<void> {
    await req(`${this.baseUrl}/api/backup`, { method: 'POST', headers: this.headers })
  }

  async restartService(name: string): Promise<void> {
    await req(`${this.baseUrl}/api/services/${encodeURIComponent(name)}/restart`, {
      method: 'POST',
      headers: this.headers,
    })
  }
}

export function createLiveBackends(conn: Connection, creds: Credentials): Backends {
  return {
    photos: new ImmichPhotoBackend(require(conn.immichUrl, 'Immich URL'), creds.immichApiKey),
    files: new NextcloudFileBackend(
      require(conn.nextcloudUrl, 'Nextcloud URL'),
      creds.nextcloudUser,
      creds.nextcloudAppPassword,
    ),
    server: new AgentServerBackend(require(conn.agentUrl, 'Agent URL'), creds.agentToken),
  }
}

function require(value: string | null, what: string): string {
  if (!value) throw new Error(`${what} is not configured`)
  return value
}
