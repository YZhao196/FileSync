/**
 * The polyfills are guarded, so under Jest they do not install — Node already
 * provides `TextEncoder` and `btoa`. That means the suite would otherwise be
 * silent about code that runs on every device build.
 *
 * These tests therefore call the fallbacks directly rather than through the
 * globals, and check them against Node's own implementations, which are a real
 * reference rather than the same logic restated.
 *
 * Not a copied file. `scripts/sync-core.mjs` governs `src/core` and `src/lib`
 * only; this is mobile's own.
 */

import { base64Encode, utf8Encode } from '../src/platform/polyfills'

/** Node's TextEncoder, which is what the fallback has to agree with. */
const referenceUtf8 = (s: string) => Array.from(new TextEncoder().encode(s))

const UTF8_CASES: Array<[string, string]> = [
  ['', 'empty'],
  ['admin:hunter2', 'plain ASCII'],
  ['Jörg Müller', 'Latin-1 accents — what the desktop bug was about'],
  ['写真', 'a script that needs three bytes per character'],
  ['🔐', 'a non-BMP character, encoded as a surrogate pair'],
  ['wörld:🔐写真', 'all of the above in one credential'],
  ['\u007f\u0080߿ࠀ￿', 'each UTF-8 length boundary'],
]

describe('utf8Encode', () => {
  for (const [input, label] of UTF8_CASES) {
    it(`matches Node for ${JSON.stringify(input)} (${label})`, () => {
      expect(Array.from(utf8Encode(input))).toEqual(referenceUtf8(input))
    })
  }

  it('produces real bytes, not one per code unit', () => {
    // The bug this guards against: treating a code unit as a byte. 'é' is one
    // code unit and two bytes, so anything returning length 1 here is wrong.
    expect(Array.from(utf8Encode('é'))).toEqual([0xc3, 0xa9])
  })
})

const BASE64_CASES: Array<[string, string]> = [
  ['', 'empty'],
  ['a', 'one byte — the padding case'],
  ['ab', 'two bytes — also padding'],
  ['abc', 'three bytes — no padding'],
  ['admin:hunter2', 'a real credential'],
  ['ÿÿÿ', 'the top of the binary-string range'],
]

describe('base64Encode', () => {
  for (const [input, label] of BASE64_CASES) {
    it(`matches Node for ${JSON.stringify(input)} (${label})`, () => {
      expect(base64Encode(input)).toBe(Buffer.from(input, 'binary').toString('base64'))
    })
  }
})

describe('the lenient DOMParser', () => {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

  it('parses well-formed XML', () => {
    expect(parse('<a><b/></a>').documentElement.tagName).toBe('a')
  })

  it('does not throw on malformed XML, where xmldom alone would', () => {
    // The desktop's own assertion, and the reason this wrapper exists.
    expect(() => parse('<not xml')).not.toThrow()
  })

  it('returns a document with no entries rather than a thrown error', () => {
    expect(parse('<not xml').getElementsByTagNameNS('DAV:', 'response')).toHaveLength(0)
  })
})
