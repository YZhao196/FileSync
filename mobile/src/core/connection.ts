/**
 * Working out where the server is, and saying plainly what happened when we
 * tried to reach it.
 *
 * Split out of `client.ts` so the mobile client can share it — see
 * `scripts/sync-core.mjs`. What is left behind in `client.ts` is the part that
 * genuinely differs per platform: which backend implementation to construct,
 * and how a build knows it is a development build.
 *
 * Nothing here is desktop-specific. The ports are the ports on both clients,
 * and the wording of a failed connection is the wording on both — which is the
 * reason to share it rather than let two copies drift into describing the same
 * failure two different ways.
 */

import { nativeFetch } from '../native/bridge'
import type { Connection, ConnectionState, Credentials, ProbeResult } from './types'

/**
 * One address in, three endpoints out. Ports match PLAN.md §6/§11 — everything
 * rides Tailscale, so plain http on the tailnet is expected.
 */
export const DEFAULT_PORTS = {
  immich: 2283,
  nextcloud: 8080,
  agent: 8787,
} as const

export const EMPTY_CREDENTIALS: Credentials = {
  immichApiKey: '',
  nextcloudUser: '',
  nextcloudAppPassword: '',
  agentToken: '',
}

export function deriveConnection(address: string): Connection {
  const empty: Connection = {
    address: '',
    immichUrl: null,
    nextcloudUrl: null,
    agentUrl: null,
  }

  const trimmed = address.trim()
  if (!trimmed) return empty

  // The scheme must be decided before any trailing-slash cleanup: "http://"
  // stripped to "http:" no longer reads as a scheme and would get prefixed,
  // yielding a nonsense host.
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return empty
  }
  if (!url.hostname) return empty

  const proto = url.protocol === 'https:' ? 'https' : 'http'
  return {
    address: trimmed.replace(/\/+$/, ''),
    immichUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.immich}`,
    nextcloudUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.nextcloud}`,
    agentUrl: `${proto}://${url.hostname}:${DEFAULT_PORTS.agent}`,
  }
}

/* ── Connection test ───────────────────────────────────────────────────── */

export async function probe(url: string | null, init: RequestInit): Promise<ProbeResult> {
  if (!url) return 'skipped'
  try {
    const res = await nativeFetch(url, {
      method: (init.method as string | undefined) ?? 'GET',
      headers: init.headers as Record<string, string> | undefined,
      body: init.body as string | undefined,
    })
    if (res.status === 401 || res.status === 403) return 'auth-failed'
    return res.ok || res.status === 207 ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/** Exported for testing — the wording here is the whole point of the probe. */
export function describeConnection(
  photos: ProbeResult,
  files: ProbeResult,
  agent: ProbeResult,
  overall: ConnectionState,
): string {
  if (overall === 'healthy') return 'Connected to photos, files and the server agent.'

  const broken: string[] = []
  if (photos !== 'ok') broken.push(`photos (${label(photos)})`)
  if (files !== 'ok') broken.push(`files (${label(files)})`)
  if (agent !== 'ok') broken.push(`server agent (${label(agent)})`)

  if (overall === 'auth-failed' && broken.length === 0) {
    return 'Server found, but the credentials were rejected.'
  }
  if (broken.length === 3) {
    return "Couldn't reach your server. Is Tailscale connected on this device?"
  }
  return `Reached some of your server. Not working: ${broken.join(', ')}.`
}

function label(p: ProbeResult): string {
  return p === 'auth-failed' ? 'credentials rejected' : 'unreachable'
}
