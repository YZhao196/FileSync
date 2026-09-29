import { describe, expect, it } from 'vitest'
import { adoptRenames } from './store'

/**
 * The rename migration exists because the app's own default, back when it was
 * called ESPNAS, got written into real profiles. It must correct that and
 * nothing else: a path a user typed is theirs, and a migration that rewrites
 * one of those is worse than the stale default it was fixing.
 */
describe('adoptRenames', () => {
  it('corrects the folder a previous default wrote', () => {
    expect(adoptRenames({ fileFolder: '~/Nextcloud/espnas' }).fileFolder).toBe(
      '~/Nextcloud/FileSynapse',
    )
  })

  it('leaves a path the user typed alone', () => {
    for (const folder of [
      '~/Nextcloud/espnas-archive', // starts with it
      '~/Nextcloud/espnas/', // trailing slash
      '~/Nextcloud/ESPNAS', // different case
      '~/Documents/things',
    ]) {
      expect(adoptRenames({ fileFolder: folder }).fileFolder).toBe(folder)
    }
  })

  it('changes nothing when the key is absent', () => {
    expect(adoptRenames({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })

  it('leaves the other keys untouched', () => {
    const before = { fileFolder: '~/Nextcloud/espnas', photoFolder: '~/Pictures/immich', role: 'client' as const }
    expect(adoptRenames(before)).toEqual({
      fileFolder: '~/Nextcloud/FileSynapse',
      photoFolder: '~/Pictures/immich',
      role: 'client',
    })
  })
})
