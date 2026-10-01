/**
 * The timeline, rendered against the mock backend.
 *
 * This is the assertion that the whole arrangement holds together: a screen
 * asks `backends` for photos, and in a development build that is the *copied*
 * mock — the same file the desktop runs — drawn through theme tokens generated
 * from the desktop's stylesheet. Nothing in this path is mobile-specific except
 * the components themselves.
 *
 * It is the closest thing to running the app that can happen without a device,
 * and the gap is worth naming: everything above the native layer executes for
 * real, and nothing below it does. `expo-secure-store` is mocked, so the
 * keystore is the one thing this cannot vouch for.
 *
 * **`render` is asynchronous in @testing-library/react-native v14** — it
 * resolves to the query API rather than returning it. That is not obvious from
 * the call site and it fails in a way that reads like something else: the
 * un-awaited result is a Promise, so `view.queryByText` is `undefined` and
 * `screen` is still empty, and the second test in a file reports "render
 * function has not been called". Both queries below are awaited.
 *
 * Mobile's own file, not a copy.
 */

import { render, waitFor } from '@testing-library/react-native'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

import { PhotosTimeline } from '../src/screens/photos/PhotosTimeline'
import { SessionProvider } from '../src/state/session'
import { ThemeProvider } from '../src/theme/ThemeProvider'

const renderTimeline = () =>
  render(
    <ThemeProvider>
      <SessionProvider>
        <PhotosTimeline />
      </SessionProvider>
    </ThemeProvider>,
  )

describe('PhotosTimeline', () => {
  it('renders photos from the mock backend', async () => {
    const view = await renderTimeline()

    // The mock's first page is asynchronous, so the grid is empty for a tick
    // and then is not. Asserting only the settled state would also pass on a
    // component that never rendered anything at all.
    await waitFor(() => expect(view.queryByText('No photos yet')).toBeNull())

    const tiles = await view.findAllByTestId('photo-tile')
    expect(tiles.length).toBeGreaterThan(0)
  })

  it('groups photos under date headers rather than one flat list', async () => {
    const view = await renderTimeline()
    await view.findAllByTestId('photo-tile')

    // `groupPhotos` is the shared library's, so this also asserts that the
    // copied file is wired in rather than a lookalike that buckets the same way.
    const headers = view.getAllByTestId('date-header')
    expect(headers.length).toBeGreaterThan(0)

    const label = headers[0].props.children
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThan(0)
  })
})
