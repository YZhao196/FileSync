/**
 * Jest, configured by *extending* the `jest-expo` preset rather than letting
 * package.json override it.
 *
 * That distinction matters: the preset installs React Native's own mocks
 * through `setupFiles`, and writing a `jest` key in package.json would replace
 * that array wholesale and break every component test in a way that reads like
 * a config error somewhere else.
 *
 * The `vitest` alias is what lets the copied tests run here unmodified. See
 * `test/vitest-shim.js` for why they are not rewritten instead.
 */

const preset = require('jest-expo/jest-preset')

module.exports = {
  ...preset,

  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/test/setup.js'],

  moduleNameMapper: {
    ...(preset.moduleNameMapper ?? {}),
    '^vitest$': '<rootDir>/test/vitest-shim.js',
    // AsyncStorage is a native module, so under Jest it resolves to an
    // implementation that immediately throws about a null NativeModule. The
    // package ships an in-memory stand-in for exactly this; pointing at it is
    // the documented fix rather than something to work around.
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
  },

  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}', '<rootDir>/test/**/*.test.{ts,tsx}'],
}
