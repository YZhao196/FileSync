import { describe, expect, it } from 'vitest'
import { fileManagerFor, platformFrom, shortcutFor } from './platform'

const UA = {
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
}

describe('platformFrom', () => {
  it('detects each OS from its user agent', () => {
    expect(platformFrom(UA.macos, '')).toBe('macos')
    expect(platformFrom(UA.windows, '')).toBe('windows')
    expect(platformFrom(UA.linux, '')).toBe('linux')
  })

  it('falls back to linux for anything unrecognised', () => {
    expect(platformFrom('', '')).toBe('linux')
    expect(platformFrom('Some Crawler', '')).toBe('linux')
  })

  it('lets the query parameter override detection', () => {
    expect(platformFrom(UA.windows, '?platform=macos')).toBe('macos')
    expect(platformFrom(UA.macos, '?platform=linux')).toBe('linux')
  })

  it('ignores a junk override rather than trusting it', () => {
    expect(platformFrom(UA.windows, '?platform=beos')).toBe('windows')
  })
})

describe('shortcutFor', () => {
  it('uses the command glyph alone on macOS', () => {
    expect(shortcutFor('macos', 'K')).toBe('⌘K')
  })

  it('spells out Ctrl with a plus elsewhere', () => {
    expect(shortcutFor('windows', 'K')).toBe('Ctrl+K')
    expect(shortcutFor('linux', 'K')).toBe('Ctrl+K')
  })
})

describe('fileManagerFor', () => {
  it('names the OS file manager the way its users know it', () => {
    expect(fileManagerFor('macos')).toBe('Finder')
    expect(fileManagerFor('windows')).toBe('File Explorer')
    // No single default exists on Linux, so it stays generic on purpose.
    expect(fileManagerFor('linux')).toBe('your file manager')
  })
})
