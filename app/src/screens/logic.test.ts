import { describe, expect, it } from 'vitest'
import type { Photo, TreeNode } from '../core/types'
import { backupSummary, isBackupCurrent } from '../lib/backup'
import { joinPath, parentOf, sameRoot } from '../lib/paths'
import { applyFilter, groupPhotos, safeFilename } from '../lib/photos'
import { flatten, iconFor } from './files/FilesBrowser'

const photo = (id: number, dateGroup: string, extra: Partial<Photo> = {}): Photo => ({
  id: `p${id}`,
  name: `IMG_${id}.jpg`,
  dateGroup,
  takenAt: null,
  isVideo: false,
  isFavourite: false,
  gradient: ['#fff', '#000'],
  ...extra,
})

describe('groupPhotos', () => {
  it('preserves first-seen order rather than sorting', () => {
    const groups = groupPhotos([
      photo(1, 'Today'),
      photo(2, 'September 2026'),
      photo(3, 'Today'),
    ])
    expect(groups.map((g) => g.date)).toEqual(['Today', 'September 2026'])
  })

  it('collects every photo into its group', () => {
    const groups = groupPhotos([photo(1, 'Today'), photo(2, 'Today'), photo(3, 'August 2026')])
    expect(groups[0]?.photos.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(groups[1]?.photos.map((p) => p.id)).toEqual(['p3'])
  })

  it('returns nothing for an empty library', () => {
    expect(groupPhotos([])).toEqual([])
  })
})

describe('applyFilter', () => {
  const photos = [
    photo(1, 'Today', { isVideo: false, isFavourite: true }),
    photo(2, 'Today', { isVideo: true }),
    photo(3, 'Today', { isVideo: false }),
  ]

  it('separates photos from videos', () => {
    expect(applyFilter(photos, 'photos').map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(applyFilter(photos, 'videos').map((p) => p.id)).toEqual(['p2'])
  })

  it('keeps only favourites', () => {
    expect(applyFilter(photos, 'favourites').map((p) => p.id)).toEqual(['p1'])
  })

  it('passes everything through for "all"', () => {
    expect(applyFilter(photos, 'all')).toHaveLength(3)
  })
})

describe('safeFilename', () => {
  it('strips characters that cannot appear in a path', () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j.jpg')).toBe('a_b_c_d_e_f_g_h_i_j.jpg')
  })

  it('falls back when nothing usable is left', () => {
    expect(safeFilename('   ')).toBe('download')
    // A name of only separators survives sanitising as "___", which is a legal
    // filename and a useless one — the fallback covers that too.
    expect(safeFilename('///')).toBe('download')
    expect(safeFilename('***???')).toBe('download')
  })

  it('keeps non-ASCII names, which are perfectly legal', () => {
    expect(safeFilename('Ünïcode 写真.jpg')).toBe('Ünïcode 写真.jpg')
  })
})

const TREE: TreeNode[] = [
  {
    id: 'projects',
    name: 'projects',
    path: '/projects',
    isFolder: true,
    children: [
      { id: 'doc', name: 'README.md', path: '/projects/README.md', isFolder: false },
      {
        id: 'src',
        name: 'src',
        path: '/projects/src',
        isFolder: true,
        children: [{ id: 'index', name: 'index.ts', path: '/projects/src/index.ts', isFolder: false }],
      },
    ],
  },
  { id: 'documents', name: 'documents', path: '/documents', isFolder: true },
]

describe('flatten', () => {
  it('shows only the top level when nothing is expanded', () => {
    const rows = flatten(TREE, new Set())
    expect(rows.map((r) => r.name)).toEqual(['projects', 'documents'])
  })

  it('reveals children of an expanded folder', () => {
    const rows = flatten(TREE, new Set(['/projects']))
    expect(rows.map((r) => r.name)).toEqual(['projects', 'README.md', 'src', 'documents'])
  })

  it('does not reveal grandchildren until their parent is expanded too', () => {
    const rows = flatten(TREE, new Set(['/projects']))
    expect(rows.map((r) => r.name)).not.toContain('index.ts')

    const deeper = flatten(TREE, new Set(['/projects', '/projects/src']))
    expect(deeper.map((r) => r.name)).toContain('index.ts')
  })

  it('tracks depth for indentation', () => {
    const rows = flatten(TREE, new Set(['/projects', '/projects/src']))
    expect(rows.find((r) => r.name === 'projects')?.depth).toBe(0)
    expect(rows.find((r) => r.name === 'src')?.depth).toBe(1)
    expect(rows.find((r) => r.name === 'index.ts')?.depth).toBe(2)
  })

  it('marks whether a row can be expanded', () => {
    const rows = flatten(TREE, new Set())
    expect(rows.find((r) => r.name === 'projects')?.hasChildren).toBe(true)
    expect(rows.find((r) => r.name === 'documents')?.hasChildren).toBe(false)
  })
})

describe('iconFor', () => {
  it('picks an icon from the extension', () => {
    expect(iconFor('cover.png', false)).toBe('file-image')
    expect(iconFor('notes.md', false)).toBe('file-text')
    expect(iconFor('backup.tar.gz', false)).toBe('archive')
  })

  // Anything the app can render as text gets the text icon, so the glyph and
  // the Preview button agree. `package.json` used to fall through to the plain
  // file icon while still being previewable, which read as a contradiction.
  it('uses the text icon for every previewable text format', () => {
    expect(iconFor('package.json', false)).toBe('file-text')
    expect(iconFor('index.ts', false)).toBe('file-text')
    expect(iconFor('styles.css', false)).toBe('file-text')
  })

  it('falls back to the plain file icon for anything unknown', () => {
    expect(iconFor('Budget 2026.xlsx', false)).toBe('file')
    expect(iconFor('firmware.bin', false)).toBe('file')
  })

  it('always uses a folder icon for folders', () => {
    expect(iconFor('src', true)).toBe('folder')
    expect(iconFor('backup.tar.gz', true)).toBe('folder')
  })
})

describe('sameRoot', () => {
  it('flags two folders under the same parent', () => {
    expect(sameRoot('~/Pictures/immich', '~/Pictures/photos')).toBe(true)
  })

  it('passes when the folders are on different roots', () => {
    expect(sameRoot('~/Pictures/immich', '~/Nextcloud/espnas')).toBe(false)
  })

  it('does not warn when a path is missing', () => {
    expect(sameRoot('', '~/Nextcloud/espnas')).toBe(false)
    expect(sameRoot('~/Pictures/immich', '')).toBe(false)
  })
})

describe('isBackupCurrent', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()

  it('accepts a recent successful run', () => {
    expect(isBackupCurrent({ lastRunAt: hoursAgo(3), lastRunOk: true } as never)).toBe(true)
  })

  it('rejects a run old enough to have missed a night', () => {
    expect(isBackupCurrent({ lastRunAt: hoursAgo(72), lastRunOk: true } as never)).toBe(false)
  })

  it('rejects a failed run however recent', () => {
    expect(isBackupCurrent({ lastRunAt: hoursAgo(1), lastRunOk: false } as never)).toBe(false)
  })

  it('holds the window at 48 hours, not somewhere near it', () => {
    // The cases above sit at 3 and 72 — far from the boundary, so they would
    // pass for any window between four hours and three days. These pin the
    // number itself, because it is one of two and the other one is stricter.
    expect(isBackupCurrent({ lastRunAt: hoursAgo(47), lastRunOk: true } as never)).toBe(true)
    expect(isBackupCurrent({ lastRunAt: hoursAgo(49), lastRunOk: true } as never)).toBe(false)
  })

  it('is not the whole story, because the agent applies 36 hours first', () => {
    // `BACKUP_CURRENT_MS` in `infra/agent/agent.mjs` infers `lastRunOk` from
    // snapshot age at 36 hours on a server with no verdict file. So a run 40
    // hours old arrives here as `lastRunOk: false`, and this function reports
    // stale — even though its own window would have called 40 hours fine.
    //
    // The test asserts the *composition*, because that is the behaviour and it
    // is not visible from either file alone.
    expect(isBackupCurrent({ lastRunAt: hoursAgo(40), lastRunOk: false } as never)).toBe(false)
    // And would have said otherwise had the agent been as forgiving.
    expect(isBackupCurrent({ lastRunAt: hoursAgo(40), lastRunOk: true } as never)).toBe(true)
  })

  it('rejects a backup that has never run', () => {
    expect(isBackupCurrent({ lastRunAt: null, lastRunOk: true } as never)).toBe(false)
    expect(isBackupCurrent(undefined)).toBe(false)
  })
})

describe('backupSummary', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()

  it('names the backup as the problem when it is stale', () => {
    const text = backupSummary({ lastRunAt: hoursAgo(90), lastRunOk: true } as never, true)
    expect(text).toContain('BACKUP STALE')
  })

  it('names the services as the problem when they are down', () => {
    const text = backupSummary({ lastRunAt: hoursAgo(2), lastRunOk: true } as never, false)
    expect(text).toContain('SERVICE IS DOWN')
  })

  it('says so when there is no status at all', () => {
    expect(backupSummary(null, true)).toContain('no status')
  })
})

describe('parentOf / joinPath', () => {
  it('finds the containing folder', () => {
    expect(parentOf('/projects/espnas/README.md')).toBe('/projects/espnas')
    expect(parentOf('/projects')).toBe('/')
  })

  it('stays at the root rather than going above it', () => {
    expect(parentOf('/')).toBe('/')
    expect(parentOf('README.md')).toBe('/')
  })

  it('joins onto a folder and onto the root', () => {
    expect(joinPath('/projects', 'espnas')).toBe('/projects/espnas')
    expect(joinPath('/', 'projects')).toBe('/projects')
    expect(joinPath('/projects/', 'espnas')).toBe('/projects/espnas')
  })
})
