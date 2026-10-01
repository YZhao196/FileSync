/**
 * The web globals the shared logic layer expects, and React Native does not have.
 *
 * This module exists so `src/core` and `src/lib` can stay byte-identical copies
 * of the desktop client's files — see `scripts/sync-core.mjs`. Editing a
 * polyfill in here is always preferable to editing a copied file, because a
 * copied file that differs stops being checkable.
 *
 * Imported first, for side effects, from both the app entry (`index.ts`) and the
 * Jest setup, so the same shims are in play in both places.
 *
 * Each install is guarded: if the runtime already provides the global, it is
 * left alone. Node provides `TextEncoder` and `btoa`, so under Jest the
 * fallbacks below are not used — they exist for Hermes on a device. That means
 * a bug in one of them would not fail the test suite, which is why they are
 * exported and tested directly rather than only through the global.
 */

// `URL` and `URLSearchParams`. Used by `deriveConnection` and the Immich URL
// building. Hermes has a partial URL implementation historically; this replaces
// it. Safe to run unconditionally — the polyfill checks for itself.
import 'react-native-url-polyfill/auto'

/* ── DOMParser ──────────────────────────────────────────────────────────── */

import { DOMParser as XmldomParser } from '@xmldom/xmldom'

/**
 * `parseMultiStatus` in `core/remote.ts` parses Nextcloud's WebDAV PROPFIND
 * response with `DOMParser` and `getElementsByTagNameNS`, which is a DOM API
 * React Native does not provide.
 *
 * `@xmldom/xmldom` is used rather than a lightweight XML parser because it
 * implements that same DOM surface, namespace lookups included. A parser that
 * returned plain objects would mean rewriting `parseMultiStatus` — and then the
 * desktop and mobile clients would be parsing the same XML with different code,
 * which is the thing the copy exists to prevent.
 *
 * ## The one place xmldom is not a drop-in
 *
 * xmldom's `DOMHandler.fatalError` reports the problem and then **throws**, and
 * there is no option to change that — `onError` replaces the reporting, not the
 * throw. jsdom, which the desktop runs against, does not throw: it returns a
 * document, which is why `parseMultiStatus` can be tested against malformed
 * input at all. The desktop's own suite asserts exactly that:
 *
 *     expect(() => parseMultiStatus('<not xml', …)).not.toThrow()
 *
 * That assertion failed here the first time the copied test ran, which is what
 * this wrapper is for. It catches the fatal error and hands back a document with
 * no entries in it, so a garbled response degrades to "no files" on both
 * platforms instead of crashing the Files screen on one of them.
 *
 * The divergence that remains, stated plainly: if a server sent XML that was
 * valid up to some `<D:response>` elements and then broke, jsdom would return
 * those elements and this returns none. It cannot arise from a real Nextcloud,
 * which sends well-formed XML or a non-XML error page; the non-throwing
 * behaviour is the part that was ever reachable.
 */
class LenientDOMParser {
  parseFromString(xml: string, mimeType: string): Document {
    const parse = (input: string) =>
      new XmldomParser({
        // xmldom's default reports by dumping to console.error, which is louder
        // than a malformed response deserves and buries the useful line.
        onError: (level: string, message: string) =>
          console.warn(`[webdav] ${level} parsing the server's XML: ${message}`),
      }).parseFromString(input, mimeType) as unknown as Document

    try {
      return parse(xml)
    } catch {
      return parse('<parsererror/>')
    }
  }
}

if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
  ;(globalThis as { DOMParser?: unknown }).DOMParser = LenientDOMParser
}

/* ── TextEncoder ────────────────────────────────────────────────────────── */

/**
 * A UTF-8 encoder, correct for the full range including surrogate pairs.
 *
 * `basicAuth` in `core/remote.ts` encodes credentials before base64. A naive
 * `charCodeAt` implementation would corrupt any non-BMP character — an emoji in
 * a password — which is precisely the class of bug that function was written to
 * avoid, so this has to handle surrogate pairs rather than approximate them.
 */
export function utf8Encode(input: string): Uint8Array {
  const str = String(input)
  const bytes: number[] = []

  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i)

    // A high surrogate followed by a low surrogate is one code point. Lone
    // surrogates are passed through as-is, matching the spec's replacement
    // behaviour closely enough for credentials, which are text a user typed.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000
        i += 1
      }
    }

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }

  return new Uint8Array(bytes)
}

class Utf8TextEncoder {
  readonly encoding = 'utf-8'

  encode(input = ''): Uint8Array {
    return utf8Encode(input)
  }
}

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder?: unknown }).TextEncoder = Utf8TextEncoder
}

/* ── btoa ───────────────────────────────────────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64 over a *binary* string — one where every character is a single byte.
 *
 * That is the contract `btoa` has, and the reason `basicAuth` encodes to UTF-8
 * bytes and packs them into a string first. Anything above U+00FF is out of
 * contract here, exactly as it is for the real `btoa`.
 */
export function base64Encode(binary: string): string {
  let out = ''

  for (let i = 0; i < binary.length; i += 3) {
    const b1 = binary.charCodeAt(i)
    const b2 = binary.charCodeAt(i + 1)
    const b3 = binary.charCodeAt(i + 2)
    const hasB2 = i + 1 < binary.length
    const hasB3 = i + 2 < binary.length

    out += B64[b1 >> 2]
    out += B64[((b1 & 0x03) << 4) | (hasB2 ? b2 >> 4 : 0)]
    out += hasB2 ? B64[((b2 & 0x0f) << 2) | (hasB3 ? b3 >> 6 : 0)] : '='
    out += hasB3 ? B64[b3 & 0x3f] : '='
  }

  return out
}

if (typeof (globalThis as { btoa?: unknown }).btoa === 'undefined') {
  ;(globalThis as { btoa?: unknown }).btoa = base64Encode
}
