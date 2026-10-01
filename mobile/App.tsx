/**
 * The mobile client's entry point — the shape of the app, and nothing else.
 *
 * The provider order is load-bearing:
 *
 *   GestureHandlerRootView   must wrap everything that can be swiped, and must
 *                            be the outermost native view.
 *   SafeAreaProvider         insets for the notch and the home indicator; the
 *                            navigation container reads it.
 *   ThemeProvider            resolves light/dark once, so every screen below
 *                            reads tokens from context rather than the OS.
 *   SessionProvider          the connection and the credentials, which decides
 *                            whether First Run or the tabs render.
 *
 * `index.ts` imports the polyfills before any of this, which matters because
 * the session is what constructs the backends.
 */

import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { RootNavigator } from './src/navigation/RootNavigator'
import { SessionProvider } from './src/state/session'
import { ThemeProvider } from './src/theme/ThemeProvider'

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
