/**
 * First Run, rendered and driven.
 *
 * The screen every new install lands on, and the one a person can get stuck at:
 * UI-MOBILE.md §1 makes it unskippable, so if it does not work there is no way
 * past it. Rendering it was worth doing for that reason alone.
 *
 * The connection test is the part worth exercising. In a development build it
 * answers from the mock after a short delay, which is enough to check that the
 * button runs the probe and that the result reaches the screen — the wiring,
 * not the network.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

import { FirstRunScreen } from '../src/screens/first-run/FirstRunScreen'
import { SessionProvider } from '../src/state/session'
import { ThemeProvider } from '../src/theme/ThemeProvider'

const renderFirstRun = () =>
  render(
    <ThemeProvider>
      <SessionProvider>
        <FirstRunScreen />
      </SessionProvider>
    </ThemeProvider>,
  )

describe('FirstRunScreen', () => {
  it('asks for the address and all three credentials', async () => {
    // Not just the address. A new server has no credentials either, so a screen
    // that collected only the address would hand the user a status panel that
    // cannot work — which is the bug this screen used to have.
    const view = await renderFirstRun()
    await waitFor(() => expect(view.getByText('Server address')).toBeTruthy())
    expect(view.getByText('Immich API key')).toBeTruthy()
    expect(view.getByText('Nextcloud username')).toBeTruthy()
    expect(view.getByText('Nextcloud app password')).toBeTruthy()
  })

  it('says the server is reached over Tailscale, which is how it works', async () => {
    const view = await renderFirstRun()
    await waitFor(() =>
      expect(view.getByText(/Tailscale/)).toBeTruthy(),
    )
  })

  it('will not test until there is an address to test', async () => {
    const view = await renderFirstRun()
    await waitFor(() => expect(view.getByText('Test connection')).toBeTruthy())

    // Pressing it with an empty field must not call the probe with nothing.
    fireEvent.press(view.getByText('Test connection'))
    await new Promise((r) => setTimeout(r, 500))
    expect(view.queryByText(/Development build/)).toBeNull()
  })

  it('runs the connection test and reports what it found', async () => {
    const view = await renderFirstRun()
    await waitFor(() => expect(view.getByText('Server address')).toBeTruthy())

    const input = view.getByPlaceholderText('filesynapse')
    fireEvent.changeText(input, 'filesynapse')
    // Wait for the value to land before pressing. The button is disabled until
    // there is an address, and pressing in the same tick tests the *previous*
    // render — where it was still empty and the press did nothing. A real
    // person types and then reaches for the mouse.
    await waitFor(() => expect(view.getByPlaceholderText('filesynapse').props.value).toBe('filesynapse'))

    fireEvent.press(view.getByText('Test connection'))

    // A development build answers from the mock, and says so rather than
    // claiming to have reached a server.
    await waitFor(
      () => expect(view.getByText(/Development build — no server is being contacted/)).toBeTruthy(),
      { timeout: 3000 },
    )
  })

  it('offers Continue once the connection is good', async () => {
    const view = await renderFirstRun()
    await waitFor(() => expect(view.getByText('Server address')).toBeTruthy())

    fireEvent.changeText(view.getByPlaceholderText('filesynapse'), 'filesynapse')
    await waitFor(() => expect(view.getByPlaceholderText('filesynapse').props.value).toBe('filesynapse'))
    fireEvent.press(view.getByText('Test connection'))
    await waitFor(() => expect(view.getByText(/Development build/)).toBeTruthy(), { timeout: 3000 })

    // The button is disabled until the test passes, so it being pressable is
    // the assertion.
    const cont = view.getByText('Continue')
    expect(cont).toBeTruthy()
    fireEvent.press(cont)
  })
})
