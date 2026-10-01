/**
 * Native capability bridge.
 *
 * The app is written to run in a plain browser so it can be developed and
 * reviewed without a build toolchain. Anything that genuinely needs the OS —
 * folder dialogs, "open in Explorer", the tray, CORS-free HTTP, the keychain,
 * autostart, notifications, provisioning — goes through here and degrades to a
 * documented fallback when no Tauri shell is present.
 *
 * No npm dependency is imported: the Tauri shell injects its own globals, and
 * every command here is declared in src-tauri/src/lib.rs. That is deliberate —
 * a bridge that imported `@tauri-apps/api` would stop the browser build from
 * starting at all, which is the one thing this file exists to prevent.
 */

import type { Preflight } from '../core/types'

interface TauriGlobals {
  __TAURI_INTERNALS__?: { invoke?: InvokeFn }
  __TAURI__?: { core?: { invoke?: InvokeFn } }
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as TauriGlobals
  const internals = w.__TAURI_INTERNALS__
  if (internals?.invoke) return internals.invoke.bind(internals)
  const core = w.__TAURI__?.core
  if (core?.invoke) return core.invoke.bind(core)
  return null
}

/** True when running inside the Tauri shell rather than a browser tab. */
export function isNative(): boolean {
  return getInvoke() !== null
}

/* ── Folder dialog ──────────────────────────────────────────────────────── */

/**
 * Native folder dialog. Falls back to a prompt in the browser so the flow can
 * still be completed while reviewing.
 */
export async function pickFolder(initialPath?: string): Promise<string | null> {
  const invoke = getInvoke()
  if (invoke) {
    try {
      const res = await invoke('plugin:dialog|open', {
        options: { directory: true, multiple: false, defaultPath: initialPath },
      })
      return typeof res === 'string' ? res : null
    } catch (err) {
      console.warn('[bridge] dialog plugin unavailable, falling back', err)
    }
  }

  const typed = globalThis.prompt(
    'Folder path — no native dialog is available in this build (see filesynapsetodo.md).',
    initialPath ?? '',
  )
  return typed && typed.trim() ? typed.trim() : null
}

/* ── File manager / URL opener ──────────────────────────────────────────── */

/** Hand a path to the OS file manager. */
export async function revealInSystem(path: string): Promise<boolean> {
  const invoke = getInvoke()
  if (invoke) {
    try {
      await invoke('plugin:opener|open_path', { path })
      return true
    } catch (err) {
      console.warn('[bridge] opener plugin unavailable', err)
    }
  }
  return false
}

/** Open a URL in the user's browser (Cockpit, Portainer). */
export async function openExternal(url: string): Promise<boolean> {
  const invoke = getInvoke()
  if (invoke) {
    try {
      await invoke('plugin:opener|open_url', { url })
      return true
    } catch (err) {
      console.warn('[bridge] opener plugin unavailable', err)
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  }
  return false
}

/* ── CORS-free HTTP ─────────────────────────────────────────────────────── */

/**
 * Minimal Response-like interface covering the methods the app actually uses.
 * `fetch` in the browser and `nativeFetch` on the native path both satisfy it.
 */
export interface NativeResponse {
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
  blob(): Promise<Blob>
}

/**
 * HTTP fetch that routes through Rust when running in the Tauri shell,
 * sidestepping the webview's CORS enforcement.
 *
 * Falls back to the global `fetch` in the browser (dev mode). In that case
 * Immich and Nextcloud will fail with CORS errors in live mode — which is
 * expected and documented in filesynapsetodo.md §4.
 *
 * Accepts the subset of `RequestInit` the app uses: `method`, `headers`
 * (Record<string, string>), `body` (string). `AbortSignal` is silently ignored
 * on the native path; the Rust command carries its own 10 s timeout.
 */
/**
 * The other half of the Rust side's base64 encoding.
 *
 * Exported and tested on its own because it is the one place a body could be
 * silently mangled: a byte lost here corrupts every photograph and every
 * WebDAV response at once, and the symptom would be a broken image rather than
 * anything pointing at this function.
 *
 * The return type names `ArrayBuffer` rather than leaving it generic: a plain
 * `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which includes
 * `SharedArrayBuffer` and is therefore not assignable to `BlobPart`. Constructed
 * from a length it is always a plain `ArrayBuffer`, so saying so is accurate as
 * well as necessary.
 */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!value) return new Uint8Array(0)

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function nativeFetch(
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<NativeResponse> {
  const invoke = getInvoke()

  if (invoke) {
    try {
      // Wrapped in `req`: the Rust command takes one struct argument named req.
      const result = (await invoke('http_request', {
        req: {
          url,
          method: (init.method ?? 'GET').toUpperCase(),
          headers: init.headers ?? {},
          body: init.body ?? null,
        },
      })) as {
        status: number
        statusText: string
        bodyBase64: string
        contentType: string | null
      }

      const bytes = decodeBase64(result.bodyBase64)

      return {
        status: result.status,
        statusText: result.statusText,
        ok: result.status >= 200 && result.status < 300,
        json: async <T = unknown>() => JSON.parse(new TextDecoder().decode(bytes)) as T,
        text: async () => new TextDecoder().decode(bytes),
        blob: async () => new Blob([bytes], { type: result.contentType ?? '' }),
      }
    } catch (err) {
      console.warn('[bridge] http_request invoke failed, falling back to fetch', err)
    }
  }

  // Browser / dev fallback — subject to CORS.
  return fetch(url, init) as unknown as NativeResponse
}

/* ── OS keychain ────────────────────────────────────────────────────────── */

const CRED_ACCOUNTS = ['immichApiKey', 'nextcloudUser', 'nextcloudAppPassword', 'agentToken'] as const
type CredAccount = (typeof CRED_ACCOUNTS)[number]

/**
 * Persists credentials to the OS keychain (Windows Credential Manager,
 * macOS Keychain, libsecret on Linux). No-ops silently in the browser.
 *
 * Empty values are deleted from the keychain rather than stored as empty
 * strings, so a credential the user blanks out is properly removed.
 */
export async function saveCredentials(creds: Record<string, string>): Promise<void> {
  const invoke = getInvoke()
  if (!invoke) return

  await Promise.all(
    CRED_ACCOUNTS.map((account) =>
      invoke('store_credential', {
        account,
        value: creds[account] || null,
      }).catch((err: unknown) =>
        console.warn(`[bridge] failed to save credential '${account}'`, err),
      ),
    ),
  )
}

/**
 * Loads credentials from the OS keychain.
 *
 * Returns only the accounts that have a stored value; missing ones are
 * omitted so callers can merge with existing state without overwriting
 * intentional blanks.
 *
 * Always returns an empty object in the browser.
 */
export async function loadCredentials(): Promise<Partial<Record<CredAccount, string>>> {
  const invoke = getInvoke()
  if (!invoke) return {}

  const pairs = await Promise.all(
    CRED_ACCOUNTS.map(async (account) => {
      try {
        const val = (await invoke('get_credential', { account })) as string | null
        return [account, val] as const
      } catch (err) {
        console.warn(`[bridge] failed to load credential '${account}'`, err)
        return [account, null] as const
      }
    }),
  )

  return Object.fromEntries(pairs.filter(([, v]) => v !== null)) as Partial<
    Record<CredAccount, string>
  >
}

/* ── Saving a file ──────────────────────────────────────────────────────── */

/**
 * Saves bytes to a location the user picks.
 *
 * Two different things, deliberately: on the desktop the OS save dialog names
 * the file and a Rust command writes it, so the file lands somewhere real. In
 * the browser there is no filesystem, so it becomes an ordinary download. Both
 * return whether the user went through with it.
 */
export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  const invoke = getInvoke()

  if (invoke) {
    try {
      const path = (await invoke('plugin:dialog|save', {
        options: { defaultPath: name },
      })) as string | null
      if (!path) return false

      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
      await invoke('write_file', { path, contents: bytes })
      return true
    } catch (err) {
      console.warn('[bridge] native save failed, falling back to a download', err)
    }
  }

  if (typeof document === 'undefined') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: revoking synchronously can cancel the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

/* ── Notifications, autostart, tray ─────────────────────────────────────── */

/** System notification. Returns false where the OS or shell has none. */
export async function notify(title: string, body: string): Promise<boolean> {
  const invoke = getInvoke()
  if (!invoke) return false
  try {
    await invoke('notify', { title, body })
    return true
  } catch (err) {
    console.warn('[bridge] notification failed', err)
    return false
  }
}

/** Launch-at-login. `null` means the shell cannot say. */
export async function getAutostart(): Promise<boolean | null> {
  const invoke = getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('get_autostart')) as boolean
  } catch (err) {
    console.warn('[bridge] autostart read failed', err)
    return null
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  const invoke = getInvoke()
  if (!invoke) return false
  try {
    await invoke('set_autostart', { enabled })
    return true
  } catch (err) {
    console.warn('[bridge] autostart write failed', err)
    return false
  }
}

export async function getTrayEnabled(): Promise<boolean | null> {
  const invoke = getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('get_tray_enabled')) as boolean
  } catch {
    return null
  }
}

export async function setTrayEnabled(enabled: boolean): Promise<boolean> {
  const invoke = getInvoke()
  if (!invoke) return false
  try {
    await invoke('set_tray_enabled', { enabled })
    return true
  } catch (err) {
    console.warn('[bridge] tray toggle failed', err)
    return false
  }
}

/** Updates the tray tooltip. No-ops in a browser, where there is no tray. */
export async function setTrayStatus(text: string): Promise<void> {
  const invoke = getInvoke()
  if (!invoke) return
  try {
    await invoke('set_tray_status', { text })
  } catch (err) {
    console.warn('[bridge] tray status update failed', err)
  }
}

/* ── Provisioning ───────────────────────────────────────────────────────── */

/** Reports the state of the installed app, for the Settings screen. */
export async function appInfo(): Promise<{ version: string; platform: string } | null> {
  const invoke = getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('app_info')) as { version: string; platform: string }
  } catch {
    return null
  }
}

/**
 * Inspects this machine before any provisioning is offered.
 *
 * In the browser there is nothing to inspect, so this returns a shape the UI can
 * render honestly — everything unavailable, and a blocker saying why.
 */
export async function preflight(): Promise<Preflight> {
  const invoke = getInvoke()
  if (invoke) {
    try {
      return (await invoke('preflight')) as Preflight
    } catch (err) {
      console.warn('[bridge] preflight failed', err)
    }
  }
  return {
    ok: false,
    platform: 'browser',
    isLinux: false,
    hasDocker: false,
    hasCompose: false,
    isRoot: false,
    dockerVersion: null,
    composeVersion: null,
    volumes: [],
    blockers: ['Running in a browser — provisioning needs the desktop app on the server itself.'],
    warnings: [],
  }
}

export interface ProvisionConfig {
  photosFolder: string
  filesFolder: string
  /** The name the server is reached by. On a replacement this is the real name,
   *  even though the machine joins under the temporary one below — the services
   *  are configured for the name they will answer to. */
  tailscaleName: string
  /** Only while replacing: the machine joins the tailnet under this instead, so
   *  the working server keeps answering until the copy is verified. */
  tailscaleTempName?: string
  transfer: 'fresh' | 'sync' | 'restore'
  sourceAddress?: string
  /** Off-site backup target. Omitted means no cloud copy is configured. */
  b2Bucket?: string
  b2KeyId?: string
  b2AppKey?: string
  resticPassword?: string
}

/**
 * Starts provisioning and returns immediately; progress is polled.
 *
 * Polling rather than an event stream because the shell exposes `invoke` and
 * nothing else — subscribing to Tauri events would mean pulling in the JS API
 * package, which is the dependency this bridge exists to avoid.
 */
export async function startProvision(config: ProvisionConfig): Promise<boolean> {
  const invoke = getInvoke()
  if (!invoke) return false
  try {
    await invoke('start_provision', { config })
    return true
  } catch (err) {
    console.warn('[bridge] provisioning failed to start', err)
    return false
  }
}

export async function provisionStatus(): Promise<ProvisionRun | null> {
  const invoke = getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('provision_status')) as ProvisionRun
  } catch {
    return null
  }
}

export interface ProvisionRun {
  running: boolean
  done: boolean
  failed: boolean
  events: Array<{ step: string; state: 'start' | 'ok' | 'skipped' | 'failed'; detail?: string }>
}
