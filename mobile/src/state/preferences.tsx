/**
 * The settings that are neither the connection nor a credential.
 *
 * Appearance is the only one so far, and it is a preference rather than state a
 * screen reads back — which is why it lives above `ThemeProvider` in the tree
 * and not inside the session. The theme has to resolve before anything below it
 * renders; the session decides *what* renders, and can come later.
 *
 * Persisted with `AsyncStorage` rather than the keystore, because a theme choice
 * is a setting and not a secret. Putting it in the keystore would make the
 * keystore's contents harder to reason about for no gain — the same reasoning
 * that puts the server address there and the API key somewhere else.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { ThemePreference } from '../theme/ThemeProvider'

const THEME_KEY = 'filesynapse.theme'

interface Preferences {
  /** False until the stored values have been read. */
  ready: boolean
  theme: ThemePreference
  setTheme: (next: ThemePreference) => Promise<void>
}

const PreferencesContext = createContext<Preferences | null>(null)

const THEMES: ThemePreference[] = ['system', 'light', 'dark']

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [theme, setThemeState] = useState<ThemePreference>('system')

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(THEME_KEY)
      .then((stored) => {
        // Validated rather than trusted: this is a value that a previous
        // version of the app, or a person with a file editor, could have left
        // in any shape. An unrecognised theme would otherwise reach
        // `resolveThemeName` and be treated as an explicit choice of nothing.
        if (!cancelled && stored && (THEMES as string[]).includes(stored)) {
          setThemeState(stored as ThemePreference)
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback(async (next: ThemePreference) => {
    setThemeState(next)
    await AsyncStorage.setItem(THEME_KEY, next)
  }, [])

  const value = useMemo<Preferences>(() => ({ ready, theme, setTheme }), [ready, theme, setTheme])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext)
  if (!preferences) throw new Error('usePreferences was called outside a PreferencesProvider')
  return preferences
}
