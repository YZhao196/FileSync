/**
 * The mobile client's entry point — the shape of the app, and nothing else.
 *
 * The provider order is load-bearing:
 *
 *   GestureHandlerRootView   must wrap everything that can be swiped, and must
 *                            be the outermost native view.
 *   SafeAreaProvider         insets for the notch and the home indicator; the
 *                            navigation container reads it.
 *   PreferencesProvider      the stored theme choice, which has to be known
 *                            before anything renders in a colour.
 *   ThemeProvider            resolves light/dark once — from the preference and
 *                            the OS — so every screen below reads tokens from
 *                            context rather than asking the platform.
 *   SessionProvider          the connection and the credentials, which decides
 *                            whether First Run or the tabs render.
 *
 * Preferences sit above the theme because the theme cannot resolve without
 * them. The session sits below, because it decides what renders rather than how.
 *
 * `index.ts` imports the polyfills before any of this, which matters because
 * the session is what constructs the backends.
 */

import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { RootNavigator } from './src/navigation/RootNavigator'
import { PreferencesProvider, usePreferences } from './src/state/preferences'
import { SessionProvider } from './src/state/session'
import { ThemeProvider } from './src/theme/ThemeProvider'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <Themed />
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/** Reads the stored theme choice and hands it to the theme. */
function Themed() {
  const { theme } = usePreferences()

  return (
    <ThemeProvider preference={theme}>
      <SessionProvider>
        <RootNavigator />
        <StatusBar style="auto" />
      </SessionProvider>
    </ThemeProvider>
  )
}
