// First, and for its side effects: `src/core` and `src/lib` are byte-identical
// copies of the desktop client's files and expect `DOMParser`, `URL`,
// `TextEncoder` and `btoa`. Hermes does not have all of them. Nothing may be
// imported before this — see src/platform/polyfills.ts.
import './src/platform/polyfills'

import { registerRootComponent } from 'expo'

import App from './App'

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App)
