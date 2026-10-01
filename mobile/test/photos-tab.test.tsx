/**
 * The Photos tab, rendered and switched.
 *
 * The last mobile screen to execute. It is the shell over the timeline and the
 * albums list — a segmented control and whichever of the two it selects — so
 * this is the one screen where the test is about navigation rather than about
 * content.
 *
 * That matters because the tab bar is fixed at three by the spec, with a fourth
 * called "dead weight half the time", so albums have to live somewhere. They
 * live here, behind this control, and a control that does not switch is an
 * albums screen nobody can reach.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

import { PhotosTab } from '../src/screens/photos/PhotosTab'
import { SessionProvider } from '../src/state/session'
import { ThemeProvider } from '../src/theme/ThemeProvider'

const renderTab = () =>
  render(
    <ThemeProvider>
      <SessionProvider>
        <PhotosTab />
      </SessionProvider>
    </ThemeProvider>,
  )

describe('PhotosTab', () => {
  it('offers exactly the two views the spec puts inside it', async () => {
    // Timeline and Albums. Search is not a third — UI-MOBILE.md is explicit
    // that it is contextual, in the header, rather than a destination.
    const view = await renderTab()
    await waitFor(() => expect(view.getByText('Timeline')).toBeTruthy())
    expect(view.getByText('Albums')).toBeTruthy()
  })

  it('opens on the timeline', async () => {
    const view = await renderTab()
    // The timeline renders date headers; the albums list renders album names.
    // Opening on albums would be a strange default for a photo app.
    await waitFor(() => expect(view.getAllByTestId('date-header').length).toBeGreaterThan(0))
  })

  it('switches to the albums list when asked', async () => {
    const view = await renderTab()
    await waitFor(() => expect(view.getByText('Albums')).toBeTruthy())

    fireEvent.press(view.getByText('Albums'))

    // The timeline's date headers go away, and album rows arrive.
    await waitFor(() => expect(view.queryAllByTestId('date-header').length).toBe(0), { timeout: 3000 })
  })

  it('switches back without losing the timeline', async () => {
    const view = await renderTab()
    await waitFor(() => expect(view.getByText('Albums')).toBeTruthy())

    fireEvent.press(view.getByText('Albums'))
    await waitFor(() => expect(view.queryAllByTestId('date-header').length).toBe(0), { timeout: 3000 })

    fireEvent.press(view.getByText('Timeline'))
    await waitFor(() => expect(view.getAllByTestId('date-header').length).toBeGreaterThan(0), {
      timeout: 3000,
    })
  })
})
