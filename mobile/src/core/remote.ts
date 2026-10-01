/**
 * Live backends. Arm's-length HTTP clients for Immich, Nextcloud and the host
 * agent — no vendor code is imported, vendored or linked (PLAN.md §13.4).
 *
 * CHECKED against Immich's OpenAPI spec at v3.2.4 (the release the provisioning
 * script fetches via `releases/latest`) and against its server source; Nextcloud
 * against its WebDAV documentation. What has still never happened is a request
 * to a live server, so anything a spec cannot settle keeps a labelled
 * `UNVERIFIED:` note. Three calls were outright wrong and are fixed below —
 * `thumb`, `albumAssets` and `share`.
 *
 * Immich versions matter, and several shapes changed across them. Each of these
 * was confirmed against the spec tagged at the stated version:
 *   - `GET /api/albums/{id}` stopped returning `assets` in **v3.0.0**;
 *     `AlbumResponseDto` has had no such field since (it did in v2.5.0 and
 *     earlier). Album contents now come from the search endpoint.
 *   - `POST /api/shared-links` with `type: 'ALBUM'` requires an `albumId` and
 *     rejects a bare `assetIds` list with 400. Sharing selected photos is always
 *     `INDIVIDUAL`, which accepts any number of asset ids.
 *   - The large thumbnail render is `/api/assets/{id}/thumbnail?size=preview`.
 *     There has never been an `/api/assets/{id}/preview` route.
 *   - `page` and `nextPage` on the search response are deprecated from
 *     **v3.2.0** in favour of `cursor`/`nextCursor`, but still work.
 *
 * The response envelope is settled: `SearchResponseDto` is
 * `{ albums, assets: { items, ... } }`, so `assets.items` is right.
 *
 * Auth, both from the v3.2.4 source: Immich authenticates with the `x-api-key`
 * header (`Authorization: Bearer` is for its own JWTs, not API keys). Since
 * **v2.0.0** every route declares the permission it needs — `/search/metadata`
 * wants `asset.read` — so a scoped key is accepted where its permissions cover
 * the route; an undeclared route would default to `all`. That default is where
 * the old "a scoped key 403s from every metadata route" note came from: it was
 * true of v1.136.0, where the routes declared nothing, and is no longer true of
 * v2.0.0 onward. `all` is still the simple choice, because this client touches
 * most of the permissions anyway.
 *
 * One correction to an earlier note: the server *does* read an `?apiKey=` query
 * parameter (auth.service.ts, v3.2.4 and back to v1.136.0). The client keeps
 * sending the header regardless — a key in a URL leaks into logs and referrers.
 */

import { nativeFetch, type NativeResponse } from '../native/bridge'
import type { Backends, FileBackend, PhotoBackend, ServerBackend } from './backends'
import type {
  Album,
  AlbumSuggestion,
  Connection,
  Credentials,
  DecisionStatus,
  FileEntry,
  Photo,
  PhotoId,
  PhotoPage,
  ScoreResult,
  ServerStatus,
  TreeNode,
} from './types'

/**
 * Photos per request. Immich's own default, and small enough that the first
 * page arrives promptly over a tailnet while the rest streams in behind it.
 */
export const PHOTO_PAGE_SIZE = 100

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

  async list(opts: { page: number; from?: Date; to?: Date }): Promise<PhotoPage> {
    return this.searchMetadata({ page: opts.page, from: opts.from, to: opts.to })
  }

  /**
   * `POST /api/search/metadata` is the endpoint behind the timeline. Immich
   * does the paging and filtering; the client only renders what comes back
   * (PLAN.md §11 — "server-side ML is free via API").
   *
   * The envelope is confirmed: at v3.2.4 the response is `SearchResponseDto`,
   * which carries the page at `assets.items`. `nextPage` exists too, but this
   * client deliberately does not trust it — `hasMore` comes from the page coming
   * back full, which holds for any paging scheme and cannot silently stop the
   * timeline at one page.
   *
   * UNVERIFIED: `page` is deprecated from v3.2.0 in favour of `cursor`, and
   * `takenAfter`/`takenBefore` likewise (the structured `filter` tree is the new
   * shape). All three still work — a request carrying none of
   * `filter`/`orderBy`/`cursor` is routed down the legacy path, which honours
   * them — but that path is on its way out and has not been exercised against a
   * live v3 server.
   */
  private async searchMetadata(opts: {
    page?: number
    size?: number
    from?: Date
    to?: Date
  }): Promise<PhotoPage> {
    const size = opts.size ?? PHOTO_PAGE_SIZE
    const body: Record<string, unknown> = {
      page: opts.page ?? 1,
      size,
    }
    if (opts.from) body.takenAfter = opts.from.toISOString()
    if (opts.to) body.takenBefore = opts.to.toISOString()

    const res = await req(`${this.baseUrl}/api/search/metadata`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { assets?: { items?: ImmichAsset[] } }
    const items = json.assets?.items ?? []
    return { photos: items.map(toPhoto), hasMore: items.length >= size }
  }

  async get(id: PhotoId): Promise<Photo> {
    const res = await req(`${this.baseUrl}/api/assets/${id}`, { headers: this.headers })
    return toPhoto((await res.json()) as ImmichAsset)
  }

  /**
   * Immich has a single thumbnail route; the `size` parameter chooses the
   * render. `thumbnail` is the small cached one, `preview` the large one — both
   * pre-generated, never resized on request (PLAN.md §11).
   *
   * This was wrong twice over and is fixed here: there is no
   * `/api/assets/{id}/preview` route, and `small`/`large` are not valid `size`
   * values. At v3.2.4 `AssetMediaSize` is one of
   * `thumbnail|preview|fullsize|original`.
   *
   * The bytes are fetched rather than used in an `<img src>` because the call
   * needs the `x-api-key` header. The server also reads an `?apiKey=` query
   * parameter, which would allow a plain URL, but the header is kept — a key in
   * a URL leaks into logs and referrers.
   */
  async thumb(id: PhotoId, size: 'small' | 'large'): Promise<Blob | null> {
    const px = size === 'small' ? 'thumbnail' : 'preview'
    try {
      const res = await req(`${this.baseUrl}/api/assets/${id}/thumbnail?size=${px}`, {
        headers: { 'x-api-key': this.apiKey },
      })
      return await res.blob()
    } catch {
      // A missing thumbnail is not an error worth surfacing — the tile falls
      // back to its gradient, which is what the user sees anyway.
      return null
    }
  }

  /**
   * Semantic search. Endpoint and body confirmed at v3.2.4: `POST
   * /api/search/smart` taking `SmartSearchDto.query`, returning the same
   * `assets.items` envelope as the timeline.
   *
   * UNVERIFIED: a server with machine learning disabled answers 400 here
   * ("Smart search is not enabled"), which has not been seen end to end.
   */
  async search(query: string): Promise<Photo[]> {
    const res = await req(`${this.baseUrl}/api/search/smart`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ query }),
    })
    const json = (await res.json()) as { assets?: { items?: ImmichAsset[] } }
    return (json.assets?.items ?? []).map(toPhoto)
  }

  /** `GET /api/albums` returns a bare array of `AlbumResponseDto` — no wrapper.
   *  Confirmed at v3.2.4; `albumName` and `assetCount` are both present. */
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

  /**
   * `GET /api/albums/{id}` no longer carries the album's assets: v3.0.0 removed
   * the `assets` field from `AlbumResponseDto`, so reading it there read
   * `undefined` and every album rendered empty. Immich's own UI reads album
   * contents through the metadata search, filtered by `albumIds`, and so does
   * this.
   *
   * `albumIds` is marked deprecated from v3.2.0 in favour of the `filter` tree,
   * but it still works — a request without `filter`/`orderBy`/`cursor` takes the
   * legacy path, which honours it — and it is accepted back to v1, whereas
   * `filter` only exists from v3.2.0. It is the more compatible choice.
   *
   * UNVERIFIED: `size` is capped at 1000 by the API, so an album of more than
   * 1000 assets shows only the first thousand. That the cap exists is a spec
   * fact; what the album screen does at that ceiling has not been seen.
   */
  async albumAssets(albumId: string): Promise<Photo[]> {
    const res = await req(`${this.baseUrl}/api/search/metadata`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ albumIds: [albumId], size: 1000 }),
    })
    const json = (await res.json()) as { assets?: { items?: ImmichAsset[] } }
    return (json.assets?.items ?? []).map(toPhoto)
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
   * point, and it is confirmed rather than assumed: at v3.2.4 the body is
   * `AssetBulkDeleteDto { ids, force }`, and the service sets the assets'
   * status to `Trashed` when `force` is falsy and `Deleted` when it is true.
   * Deletion is recoverable for the retention window, which is what PLAN.md §10
   * asks for: the app must not be the thing that destroys data.
   */
  async remove(ids: PhotoId[]): Promise<void> {
    await req(`${this.baseUrl}/api/assets`, {
      method: 'DELETE',
      headers: this.headers,
      body: JSON.stringify({ ids, force: false }),
    })
  }

  /** `PUT /api/albums/{id}/assets` takes `BulkIdsDto` — a bare `{ ids }`, no
   *  wrapper. Confirmed at v3.2.4. (A newer `PUT /albums/assets` also exists
   *  from v3, but the per-album route is still present and is what this uses.) */
  async addToAlbum(albumId: string, ids: PhotoId[]): Promise<void> {
    await req(`${this.baseUrl}/api/albums/${albumId}/assets`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ ids }),
    })
  }

  /**
   * Creates a public share link for the selected assets.
   *
   * Always `INDIVIDUAL`: that type accepts any number of `assetIds`, whereas
   * `ALBUM` requires an `albumId` and rejects a bare asset list with
   * 400 "Invalid albumId" (shared-link.service.ts, v3.2.4). The old
   * `ids.length > 1 → ALBUM` branch was therefore wrong for every multi-select.
   *
   * The response's `key` is the link's encryption key and the public URL is
   * `{base}/share/{key}` — confirmed by the web app's own `(user)/share/[key]`
   * route.
   */
  async share(ids: PhotoId[]): Promise<string> {
    const res = await req(`${this.baseUrl}/api/shared-links`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ type: 'INDIVIDUAL', assetIds: ids }),
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
    return basicAuth(this.user, this.appPassword)
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
   * fail rather than silently replace the target. Both are confirmed against
   * Nextcloud's WebDAV docs. The URL here is absolute because the connection's
   * Nextcloud base already carries a scheme and host (see `deriveConnection`).
   *
   * UNVERIFIED: a Nextcloud reached by a hostname not in its `trusted_domains`
   * answers 400 to a Destination it does not recognise as its own, which a
   * Tailscale name may or may not be. That is a server setting, not a client bug.
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
 * `Basic` credentials, UTF-8 encoded first.
 *
 * `btoa` alone throws `InvalidCharacterError` on any code unit above U+00FF, so
 * a username or password with an accent, a non-Latin script or an emoji took
 * down every call that used it — including the connection probe on First Run.
 * Encoding to bytes first is what RFC 7617 expects anyway, and is byte-identical
 * for ASCII, which is the common case.
 *
 * Exported so the probe in `client.ts` uses this rather than a second `btoa`.
 *
 * UNVERIFIED: whether Nextcloud expects UTF-8 or ISO-8859-1 for a non-ASCII
 * Basic credential. RFC 7617 permits UTF-8; ASCII is unaffected either way.
 */
export function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `Basic ${btoa(binary)}`
}

/**
 * Exported for testing — WebDAV XML is the fiddliest part of this file.
 *
 * `selfHref` is the server-absolute path that was requested. PROPFIND Depth:1
 * returns the collection itself alongside its children, and the hrefs are
 * server-absolute while `parentPath` is app-relative, so the self entry can only
 * be identified by comparing against the request path.
 *
 * Every property read here — `getcontentlength`, `getlastmodified`,
 * `getcontenttype`, `resourcetype/collection` — is in the default set a
 * body-less PROPFIND returns, and all live in the `DAV:` namespace, so the
 * request needs no XML body and the namespace lookups are right. Confirmed
 * against Nextcloud's WebDAV docs. UNVERIFIED: the live XML dialect itself —
 * doc-versus-daemon is exactly the kind of gap a spec cannot close.
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
 * filesynapsetodo.md asks to be deployed.
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

  private get jsonHeaders(): HeadersInit {
    return { ...this.headers, 'content-type': 'application/json' }
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

  /**
   * UNVERIFIED: none of these four routes has ever been served by a deployed
   * agent. They mirror the status routes above, which are themselves unverified
   * against a real host (filesynapsetodo.md §7).
   *
   * A modelled failure — Ollama down, the model never pulled — comes back as
   * `200 {ok: false}`, matching the agent's convention that a panel saying
   * "unavailable" beats a 500. Only a genuine bug raises `HttpError` here.
   */
  async decisionStatus(): Promise<DecisionStatus> {
    const res = await req(`${this.baseUrl}/api/decisions/status`, { headers: this.headers })
    return (await res.json()) as DecisionStatus
  }

  async scorePhotos(ids: PhotoId[]): Promise<ScoreResult> {
    const res = await req(`${this.baseUrl}/api/decisions/score`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify({ ids }),
    })
    return (await res.json()) as ScoreResult
  }

  async suggestAlbums(ids: PhotoId[], albums: string[]): Promise<AlbumSuggestion[]> {
    const res = await req(`${this.baseUrl}/api/decisions/albums`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify({ ids, albums }),
    })
    const body = (await res.json()) as { ok: boolean; suggestions?: AlbumSuggestion[] }
    return body.suggestions ?? []
  }

  async clearCaptionCache(): Promise<number> {
    const res = await req(`${this.baseUrl}/api/decisions/cache/clear`, {
      method: 'POST',
      headers: this.headers,
    })
    const body = (await res.json()) as { cleared?: number }
    return body.cleared ?? 0
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
