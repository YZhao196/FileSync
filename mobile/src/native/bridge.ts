/**
 * The mobile half of `core/remote.ts`'s one outbound dependency.
 *
 * The shared files under `src/core` and `src/lib` are byte-identical copies of
 * the desktop client's — see `scripts/sync-core.mjs`. They are not edited on the
 * way across, which is what makes the drift check a plain byte comparison. What
 * lets that work is this file: `remote.ts` imports `../native/bridge`, and
 * because this directory mirrors the desktop's layout, that import lands here
 * instead of on the Tauri bridge.
 *
 * The desktop version exists to get around the webview's CORS enforcement, and
 * routes through a Rust command for that reason. React Native's `fetch` is not
 * subject to origin enforcement at all — there is no origin — so there is
 * nothing to route around. This is a typed passthrough, and that is the whole
 * file.
 *
 * The `NativeResponse` shape is kept identical rather than replaced with RN's
 * own `Response` type, so the shared client compiles against the same contract
 * on both platforms and this stays a drop-in.
 */

/** Minimal Response-like interface covering the methods the app actually uses. */
export interface NativeResponse {
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
  blob(): Promise<Blob>
}

/**
 * HTTP fetch, over React Native's global `fetch`.
 *
 * Accepts the same subset of `RequestInit` the desktop bridge does — `method`,
 * `headers` (Record<string, string>), `body` (string) — so a request built by
 * shared code is valid on both.
 *
 * UNVERIFIED: that React Native's fetch tolerates the WebDAV verbs the files
 * backend uses. `PROPFIND`, `MKCOL` and `MOVE` are non-standard methods with
 * non-standard headers (`Depth`, `Destination`), and Android's OkHttp stack has
 * historically been the fussy one. Nothing here can settle it; it needs a
 * request to a real Nextcloud.
 *
 * UNVERIFIED: `blob()` on a large response. RN's Blob support is partial, and an
 * original-resolution photo goes through this path. The filesystem-download
 * route is the intended fix if it proves to be a problem — see the mobile
 * thumbnail cache.
 */
export async function nativeFetch(
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<NativeResponse> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: init.body,
  })

  return {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    json: <T = unknown>() => res.json() as Promise<T>,
    text: () => res.text(),
    blob: () => res.blob(),
  }
}
