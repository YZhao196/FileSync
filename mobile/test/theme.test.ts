/**
 * Which theme wins, and that both themes are complete.
 *
 * The resolution rule has one case that is not obvious from reading it: React
 * Native's `useColorScheme()` can return `'unspecified'` on some Android builds,
 * which is neither 'light' nor 'dark' and must still resolve to something. That
 * is the case worth a test, because it only happens on a device the author
 * probably does not have.
 *
 * Mobile's own file, not a copy.
 */

import { resolveThemeName } from '../src/theme/ThemeProvider'
import { darkColors, lightColors, spacing, text } from '../src/theme/tokens.generated'

describe('resolveThemeName', () => {
  it('follows the OS when the preference is System', () => {
    expect(resolveThemeName('system', 'dark')).toBe('dark')
    expect(resolveThemeName('system', 'light')).toBe('light')
  })

  it('treats an unknown system value as light rather than as dark', () => {
    // `'unspecified'` is a real return value on Android. Treating anything
    // unrecognised as dark would put a dark theme on someone who never asked
    // for one, which is the more jarring of the two ways to be wrong.
    expect(resolveThemeName('system', 'unspecified')).toBe('light')
    expect(resolveThemeName('system', null)).toBe('light')
    expect(resolveThemeName('system', undefined)).toBe('light')
  })

  it('lets an explicit choice override the OS in both directions', () => {
    expect(resolveThemeName('dark', 'light')).toBe('dark')
    expect(resolveThemeName('light', 'dark')).toBe('light')
  })
})

describe('the generated tokens', () => {
  it('defines every colour in both themes', () => {
    // The generator asserts this too, so this is a guard on the committed file
    // rather than on the generator: a hand-edit to one theme would otherwise
    // surface as an undefined colour on a dark-mode screen.
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort())
  })

  it('has no empty values', () => {
    // Collected and asserted once rather than asserted per iteration: Jest's
    // `expect` takes no message argument, so a failure inside a loop names the
    // line but not which token was empty.
    const empty = Object.entries({ ...lightColors, ...darkColors })
      .filter(([, value]) => typeof value !== 'string' || value.length === 0)
      .map(([name]) => name)

    expect(empty).toEqual([])
  })

  it('converts spacing to numbers React Native can do arithmetic on', () => {
    expect(spacing['spacing-05']).toBe(16)
    expect(typeof spacing['spacing-05']).toBe('number')
  })

  it('resolves the font shorthands into the four properties React Native has', () => {
    // '400 12px/1.333 var(--font-sans)' becomes real values, and the ratio
    // becomes a pixel line height rather than being left for each screen.
    expect(text['text-label-01']).toEqual({
      fontWeight: '400',
      fontSize: 12,
      lineHeight: 16,
      fontFamily: 'IBM Plex Sans',
    })
  })
})
