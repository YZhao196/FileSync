/**
 * UI-MOBILE.md §1's validation table, as assertions.
 *
 * Worth pinning because the whole point of the table is that it says *which*
 * half failed. A refactor that collapsed these into one "couldn't connect"
 * message would still pass every other test in the suite and would send
 * somebody to check their router when the problem is a Nextcloud address.
 *
 * The shared `connection.ts` is exercised by the desktop's own tests, which run
 * here too. This file is only about the mobile-specific wording and the
 * two-endpoint shape that has no desktop equivalent.
 *
 * Mobile's own file, not a copy.
 */

import { deriveConnection } from '../src/core/connection'
import { describeMobileConnection } from '../src/core/client'

describe('describeMobileConnection', () => {
  it('reports both halves working', () => {
    expect(describeMobileConnection('ok', 'ok')).toBe('Connected to photos and files.')
  })

  it('names photos when only files failed, and says which address to look at', () => {
    const message = describeMobileConnection('ok', 'unreachable')
    expect(message).toContain('photos')
    expect(message).toContain('Nextcloud')
  })

  it('names files when only photos failed — the mirror case', () => {
    const message = describeMobileConnection('unreachable', 'ok')
    expect(message).toContain('files')
    expect(message).toContain('Immich')
  })

  it('reports rejection as credentials rather than as unreachable', () => {
    // An auth failure means the server was found. Saying "can't reach your
    // server" here sends someone to check Tailscale for a typo in a password.
    for (const pair of [
      ['auth-failed', 'auth-failed'],
      ['auth-failed', 'ok'],
      ['ok', 'auth-failed'],
    ] as const) {
      expect(describeMobileConnection(pair[0], pair[1])).toBe(
        'Server found, but the credentials were rejected.',
      )
    }
  })

  it('says Tailscale by name when nothing answers', () => {
    // The spec calls this the single most common failure and asks for it to be
    // named, rather than left as "connection refused".
    expect(describeMobileConnection('unreachable', 'unreachable')).toContain('Tailscale')
  })

  it('never reports success when a half is skipped', () => {
    expect(describeMobileConnection('skipped', 'skipped')).not.toContain('Connected')
  })
})

describe('deriveConnection, on the shared file', () => {
  it('turns one hostname into both endpoints on the right ports', () => {
    const connection = deriveConnection('filesynapse')
    expect(connection.immichUrl).toBe('http://filesynapse:2283')
    expect(connection.nextcloudUrl).toBe('http://filesynapse:8080')
  })

  it('keeps https when the address carries it', () => {
    expect(deriveConnection('https://nas.tailnet.ts.net').immichUrl).toBe(
      'https://nas.tailnet.ts.net:2283',
    )
  })

  it('treats an empty address as unconfigured rather than as a host', () => {
    expect(deriveConnection('   ').address).toBe('')
  })
})
