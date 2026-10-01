/**
 * The Files browser, rendered and tapped.
 *
 * The second mobile screen to be executed at all — see `settings.test.tsx` for
 * why that was worth doing. This one goes further than rendering: it descends
 * into a folder, which is the interaction the browser exists for and the one
 * most likely to be broken by a change to the path handling underneath it.
 *
 * The mock seeds `/projects`, `/documents` and `/photos` with files inside, so
 * the assertions are against a real tree rather than a fixture invented here.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

import { FilesScreen } from '../src/screens/files/FilesScreen'
import { SessionProvider } from '../src/state/session'
import { ThemeProvider } from '../src/theme/ThemeProvider'

const renderFiles = () =>
  render(
    <ThemeProvider>
      <SessionProvider>
        <FilesScreen />
      </SessionProvider>
    </ThemeProvider>,
  )

describe('FilesScreen', () => {
  it('lists the folders at the root', async () => {
    const view = await renderFiles()
    await waitFor(() => expect(view.getByText('documents')).toBeTruthy())
    expect(view.getByText('photos')).toBeTruthy()
    expect(view.getByText('projects')).toBeTruthy()
  })

  it('starts at the root, and says so', async () => {
    // The breadcrumb's first segment. Without it there is nothing on screen
    // saying where you are, which matters the moment you are two deep.
    const view = await renderFiles()
    await waitFor(() => expect(view.getByText('Files')).toBeTruthy())
  })

  it('shows each folder with the metadata column, not a size', async () => {
    // A folder has no size, and the screen draws an em dash rather than "0 B" —
    // a zero there reads as an empty folder rather than as a folder.
    const view = await renderFiles()
    await waitFor(() => expect(view.getByText('documents')).toBeTruthy())
    expect(view.getAllByText(/—/).length).toBeGreaterThan(0)
  })

  it('descends into a folder and lists what is inside it', async () => {
    const view = await renderFiles()
    await waitFor(() => expect(view.getByText('documents')).toBeTruthy())

    // Tap the row. The browser is a list of pressables; descending is the whole
    // of its navigation. `fireEvent.press` walks up from the label to whichever
    // ancestor handles the press, because the handler is not on the text.
    fireEvent.press(view.getByText('documents'))

    await waitFor(() => expect(view.getByText('Notes.md')).toBeTruthy())
    expect(view.getByText('Budget 2026.xlsx')).toBeTruthy()
  })

  it('replaces the listing rather than appending to it', async () => {
    // Descending must swap the directory, not add to it — a browser that
    // accumulated folders as you walked would be wrong in a way that looks
    // like a very large directory.
    const view = await renderFiles()
    await waitFor(() => expect(view.getByText('documents')).toBeTruthy())

    fireEvent.press(view.getByText('documents'))

    await waitFor(() => expect(view.getByText('Notes.md')).toBeTruthy())
    expect(view.queryByText('photos')).toBeNull()
  })
})
