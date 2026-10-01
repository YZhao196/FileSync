/**
 * Settings, rendered.
 *
 * The mobile client has no device, no web target, and until now no component
 * tests — so its screens had never been executed anywhere at all. `App.tsx` and
 * the four screens were the only part of this project with no verification of
 * any kind, which is a bigger gap than it sounds: everything the mobile tests
 * did cover was the *shared* logic, which the desktop tests already cover.
 *
 * This is the first thing to check that a mobile screen mounts.
 *
 * The native modules are mocked, and that is the honest limit of it: this
 * proves the screen renders and wires its state, not that the keystore or the
 * filesystem behave. Those need a device.
 */

import { render, waitFor } from '@testing-library/react-native'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

// A filesystem that reports an empty cache and no downloads, which is what a
// fresh install has.
jest.mock('expo-file-system', () => {
  class FakeDirectory {
    name: string
    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '')
    }
    get exists() {
      return false
    }
    list(): unknown[] {
      return []
    }
    delete() {
      /* nothing to delete */
    }
  }
  class FakeFile {
    name: string
    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '')
    }
    get exists() {
      return false
    }
    get uri() {
      return `file:///fake/${this.name}`
    }
    delete() {}
    create() {}
    write() {}
  }
  return { Directory: FakeDirectory, File: FakeFile, Paths: { cache: { name: 'cache' } } }
})

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '9.9.9' } },
}))

import { PreferencesProvider } from '../src/state/preferences'
import { SessionProvider } from '../src/state/session'
import { SettingsScreen } from '../src/screens/settings/SettingsScreen'
import { ThemeProvider } from '../src/theme/ThemeProvider'

const renderSettings = () =>
  render(
    <PreferencesProvider>
      <ThemeProvider>
        <SessionProvider>
          <SettingsScreen />
        </SessionProvider>
      </ThemeProvider>
    </PreferencesProvider>,
  )

describe('SettingsScreen', () => {
  it('renders every section the spec asks for', async () => {
    const view = await renderSettings()

    // UI-MOBILE.md §4: Server, Account, Storage & cache, Appearance, About.
    //
    // Title case, not the capitals the screen displays — the headings are
    // uppercased by `textTransform` in the style, which the rendered text does
    // not carry. Asserting the capitals was this test's own first bug.
    for (const heading of ['Server', 'Account', 'Storage & cache', 'Appearance', 'About']) {
      await waitFor(() => expect(view.getByText(heading)).toBeTruthy())
    }
  })

  it('shows the version from the app config rather than a hardcoded one', async () => {
    const view = await renderSettings()
    await waitFor(() => expect(view.getByText('9.9.9')).toBeTruthy())
  })

  it('reports both caches separately, which is the distinction the spec draws', async () => {
    const view = await renderSettings()
    // Thumbnails are derived and disposable; downloads are files the user asked
    // to keep. One button for both would delete the second without saying so,
    // so both rows and both buttons have to be there.
    await waitFor(() => expect(view.getByText('Thumbnails')).toBeTruthy())
    expect(view.getByText('Downloads')).toBeTruthy()
    expect(view.getByText('Clear thumbnail cache')).toBeTruthy()
    expect(view.getByText('Clear downloads')).toBeTruthy()
  })

  it('offers all three theme choices', async () => {
    const view = await renderSettings()
    await waitFor(() => expect(view.getByText('System')).toBeTruthy())
    expect(view.getByText('Light')).toBeTruthy()
    expect(view.getByText('Dark')).toBeTruthy()
  })

  it('says it is not connected rather than showing an empty address', async () => {
    // A blank row where the server should be reads as a rendering fault. The
    // screen says what is actually true: there is nothing configured yet.
    const view = await renderSettings()
    await waitFor(() => expect(view.getByText('Not connected')).toBeTruthy())
    expect(view.getByText('Not signed in')).toBeTruthy()
  })
})
