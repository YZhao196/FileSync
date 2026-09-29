import { describe, expect, it } from 'vitest'
import { deriveConnection, describeConnection, DEFAULT_PORTS } from './client'

describe('deriveConnection', () => {
  it('expands a bare Tailscale hostname to all three endpoints', () => {
    expect(deriveConnection('espnas')).toEqual({
      address: 'espnas',
      immichUrl: `http://espnas:${DEFAULT_PORTS.immich}`,
      nextcloudUrl: `http://espnas:${DEFAULT_PORTS.nextcloud}`,
      agentUrl: `http://espnas:${DEFAULT_PORTS.agent}`,
    })
  })

  it('honours an explicit scheme', () => {
    expect(deriveConnection('https://espnas').immichUrl).toBe(
      `https://espnas:${DEFAULT_PORTS.immich}`,
    )
  })

  it('tolerates a trailing slash', () => {
    expect(deriveConnection('http://espnas/').address).toBe('http://espnas')
  })

  it('ignores any path, keeping only the host', () => {
    expect(deriveConnection('espnas/some/path').immichUrl).toBe(
      `http://espnas:${DEFAULT_PORTS.immich}`,
    )
  })

  it('returns nulls for an empty address rather than half a connection', () => {
    expect(deriveConnection('   ')).toEqual({
      address: '',
      immichUrl: null,
      nextcloudUrl: null,
      agentUrl: null,
    })
  })

  it('returns nulls for an unparseable address', () => {
    expect(deriveConnection('http://').immichUrl).toBeNull()
  })
})

describe('describeConnection', () => {
  it('confirms a clean connection', () => {
    expect(describeConnection('ok', 'ok', 'ok', 'healthy')).toMatch(/Connected to photos, files/)
  })

  it('names Tailscale when nothing answers, since that is the usual cause', () => {
    expect(describeConnection('unreachable', 'unreachable', 'unreachable', 'unreachable')).toBe(
      "Couldn't reach your server. Is Tailscale connected on this device?",
    )
  })

  it('reports which part failed rather than a generic error', () => {
    const message = describeConnection('ok', 'unreachable', 'ok', 'unreachable')
    expect(message).toContain('files')
    expect(message).not.toContain('photos')
  })

  it('distinguishes rejected credentials from an unreachable host', () => {
    expect(describeConnection('auth-failed', 'ok', 'ok', 'auth-failed')).toContain(
      'credentials rejected',
    )
  })

  it('says auth failed when the server answered but rejected the key', () => {
    expect(describeConnection('ok', 'ok', 'ok', 'auth-failed')).toBe(
      'Server found, but the credentials were rejected.',
    )
  })
})
