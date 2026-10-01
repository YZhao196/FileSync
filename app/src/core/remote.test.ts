import { describe, expect, it } from 'vitest'
import { basicAuth, parseMultiStatus } from './remote'

const BASE = '/remote.php/dav/files/admin'

const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${BASE}/projects/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>${BASE}/projects/README.md</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>2048</d:getcontentlength>
      <d:getlastmodified>Wed, 10 Sep 2026 10:00:00 GMT</d:getlastmodified>
      <d:getcontenttype>text/markdown</d:getcontenttype>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>${BASE}/projects/cover%20art.png</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>1258291</d:getcontentlength>
      <d:getcontenttype>image/png</d:getcontenttype>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>${BASE}/projects/src/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`

describe('parseMultiStatus', () => {
  it('excludes the collection itself', () => {
    const entries = parseMultiStatus(MULTISTATUS, '/projects', `${BASE}/projects/`)
    expect(entries.map((e) => e.name)).toEqual(['README.md', 'cover art.png', 'src'])
  })

  it('works at the root, where the self path is the base', () => {
    const xml = MULTISTATUS.replace(
      `${BASE}/projects/</d:href>`,
      `${BASE}/</d:href>`,
    ).replaceAll(`${BASE}/projects/`, `${BASE}/`)
    const entries = parseMultiStatus(xml, '/', `${BASE}/`)
    // Regression: this used to drop every entry, because a "/" parent made the
    // old prefix comparison match everything.
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.map((e) => e.name)).not.toContain('admin')
  })

  it('decodes percent-encoded names', () => {
    const entries = parseMultiStatus(MULTISTATUS, '/projects', `${BASE}/projects/`)
    expect(entries.map((e) => e.name)).toContain('cover art.png')
  })

  it('distinguishes folders from files', () => {
    const entries = parseMultiStatus(MULTISTATUS, '/projects', `${BASE}/projects/`)
    expect(entries.find((e) => e.name === 'src')?.isFolder).toBe(true)
    expect(entries.find((e) => e.name === 'README.md')?.isFolder).toBe(false)
  })

  it('builds child paths from the parent', () => {
    const entries = parseMultiStatus(MULTISTATUS, '/projects', `${BASE}/projects/`)
    expect(entries.find((e) => e.name === 'README.md')?.path).toBe('/projects/README.md')
  })

  it('formats sizes and types for display', () => {
    const entries = parseMultiStatus(MULTISTATUS, '/projects', `${BASE}/projects/`)
    const readme = entries.find((e) => e.name === 'README.md')
    expect(readme?.sizeLabel).toBe('2 KB')
    expect(readme?.typeLabel).toBe('MARKDOWN')
    expect(entries.find((e) => e.name === 'src')?.sizeLabel).toBe('—')
  })

  it('survives malformed XML without throwing', () => {
    expect(() => parseMultiStatus('<not xml', '/projects', `${BASE}/projects/`)).not.toThrow()
  })
})

describe('basicAuth', () => {
  /** What a server does when it reads the header: base64 → bytes → UTF-8. */
  function decodeBasic(header: string): string {
    const binary = atob(header.replace('Basic ', ''))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  it('encodes an ASCII credential', () => {
    expect(basicAuth('admin', 'hunter2')).toBe(`Basic ${btoa('admin:hunter2')}`)
  })

  // `btoa` throws `InvalidCharacterError` on any code unit above U+00FF. This
  // reaches the user as a connection test that fails on a character rather than
  // reporting what it found, which reads as a broken server.
  it('does not throw on a credential outside Latin1', () => {
    expect(() => basicAuth('Jörg Müller', 'pässwörd—写真')).not.toThrow()
  })

  it('round-trips a non-Latin1 credential through base64', () => {
    expect(decodeBasic(basicAuth('Jörg Müller', 'pässwörd—写真'))).toBe('Jörg Müller:pässwörd—写真')
  })

  it('handles an emoji, which is two code units', () => {
    expect(decodeBasic(basicAuth('user', 'pw🔐'))).toBe('user:pw🔐')
  })
})
