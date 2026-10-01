/**
 * The theme, as React Native can express one.
 *
 * The desktop gets its themes from CSS custom properties that flip when
 * `data-theme` changes on the document element. There is no cascade here and no
 * document, so the resolved values are handed down through context instead.
 *
 * The values themselves are generated from the desktop's `tokens.css` — see
 * `scripts/gen-mobile-tokens.mjs` — so both clients are drawing from one
 * palette. What differs is only how it reaches a component.
 *
 * Three sources decide the theme, in order: the user's explicit choice in
 * Settings → Appearance, then the OS setting. "System" is not a third palette,
 * it is "ask the OS".
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'

import {
  darkColors,
  fonts,
  lightColors,
  radius,
  spacing,
  text,
  type ThemeColors,
  type ThemeName,
} from './tokens.generated'

/** UI-MOBILE.md's Settings → Appearance. */
export type ThemePreference = 'system' | 'light' | 'dark'

export interface Theme {
  name: ThemeName
  color: ThemeColors
  spacing: typeof spacing
  radius: typeof radius
  text: typeof text
  fonts: typeof fonts
}

const ThemeContext = createContext<Theme | null>(null)

/**
 * Deliberately takes a bare string rather than `ThemeName`. React Native's
 * `useColorScheme()` returns `'light' | 'dark' | null | 'unspecified'`, and
 * anything that is not exactly `'dark'` means light — including the
 * `'unspecified'` case, which is a real value on some Android builds and would
 * otherwise have to be handled at every call site.
 */
export function resolveThemeName(
  preference: ThemePreference,
  system: string | null | undefined,
): ThemeName {
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light'
  return preference
}

export function ThemeProvider({
  preference = 'system',
  children,
}: {
  preference?: ThemePreference
  children: ReactNode
}) {
  const system = useColorScheme()

  const theme = useMemo<Theme>(() => {
    const name = resolveThemeName(preference, system)
    return {
      name,
      color: name === 'dark' ? darkColors : lightColors,
      spacing,
      radius,
      text,
      fonts,
    }
  }, [preference, system])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

/**
 * Throws rather than falling back to a default theme.
 *
 * A component that silently renders in the wrong theme is a bug that only shows
 * up on someone else's phone, in one of the two modes, and looks like a styling
 * mistake rather than a missing provider.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('useTheme was called outside a ThemeProvider')
  return theme
}
