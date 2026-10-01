import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `probe` decides what a response *means*, and every connection message the app
 * shows is downstream of it. Getting it wrong is not a cosmetic problem: a 403
 * read as "unreachable" sends someone to check Tailscale when the actual
 * problem is a key with the wrong permissions.
 *
 * A synced file, so mobile runs these too — see `scripts/sync-core.mjs`.
 */

const { nativeFetch } = vi.hoisted(() => ({ nativeFetch: vi.fn() }))

vi.mock('../native/bridge', () => ({ nativeFetch }))

const { probe } = await import('./connection')

/** The subset of `NativeResponse` that `probe` touches. */
const responds = (status: number, ok: boolean) => ({
  status,
  statusText: '',
  ok,
  json: async () => ({}),
  text: async () => '',
  blob: async () => new Blob(),
})

describe('probe', () => {
  beforeEach(() => {
    nativeFetch.mockReset()
  })

  it('reports a missing URL as skipped rather than as a failure', async () => {
    // An unconfigured endpoint is not a broken one — that distinction is what
    // lets `describeConnection` name *which* part is missing.
    await expect(probe(null, {})).resolves.toBe('skipped')
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('reads 200 as ok', async () => {
    nativeFetch.mockResolvedValue(responds(200, true))
    await expect(probe('http://nas:2283/x', {})).resolves.toBe('ok')
  })

  it('reads 207 as ok, because WebDAV answers that way to a PROPFIND', async () => {
    // Nextcloud returns 207 Multi-Status for a successful PROPFIND. Treating it
    // as anything other than success would report every working Nextcloud as
    // unreachable.
    nativeFetch.mockResolvedValue(responds(207, false))
    await expect(probe('http://nas:8080/x', {})).resolves.toBe('ok')
  })

  it('reads 401 and 403 as rejected credentials, not as unreachable', async () => {
    for (const status of [401, 403]) {
      nativeFetch.mockResolvedValue(responds(status, false))
      await expect(probe('http://nas:2283/x', {})).resolves.toBe('auth-failed')
    }
  })

  it('reads a thrown request as unreachable', async () => {
    nativeFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))
    await expect(probe('http://nas:2283/x', {})).resolves.toBe('unreachable')
  })

  it('reads any other status as unreachable', async () => {
    nativeFetch.mockResolvedValue(responds(500, false))
    await expect(probe('http://nas:2283/x', {})).resolves.toBe('unreachable')
  })
})
