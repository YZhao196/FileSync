import { describe, expect, it } from 'vitest'
import { decodeBase64 } from './bridge'

/**
 * Response bodies arrive from Rust base64-encoded, and this is the half that
 * undoes it.
 *
 * The vectors are deliberately the same ones `http.rs` asserts its encoder
 * against. If the two ever disagree — a padding change, a different alphabet,
 * someone reaching for base64url — the failure is a corrupted photograph, and
 * it would be blamed on the server long before anyone suspected this function.
 * Having both sides pinned to identical inputs is what makes that a test
 * failure instead.
 */
describe('decodeBase64', () => {
  const decode = (value: string) => Array.from(decodeBase64(value))

  it('handles an empty body, which a 204 or a HEAD leaves', () => {
    expect(decode('')).toEqual([])
  })

  it('undoes the three padding cases', () => {
    expect(decode('Zg==')).toEqual([0x66])
    expect(decode('Zm8=')).toEqual([0x66, 0x6f])
    expect(decode('Zm9v')).toEqual([0x66, 0x6f, 0x6f])
  })

  it('keeps the top of the byte range unsigned', () => {
    // A signed slip here turns 255 into -1, and every photograph gets a stripe
    // of black in the same place.
    expect(decode('//79')).toEqual([0xff, 0xfe, 0xfd])
    expect(decode('AAEC')).toEqual([0x00, 0x01, 0x02])
  })

  it('round-trips a body larger than one padding block', () => {
    const bytes = Array.from({ length: 1000 }, (_, i) => (i * 7) % 256)
    const binary = String.fromCharCode(...bytes)
    expect(Array.from(decodeBase64(btoa(binary)))).toEqual(bytes)
  })
})
