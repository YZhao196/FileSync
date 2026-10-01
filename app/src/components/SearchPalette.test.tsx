import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

import { AppProvider } from '../state/store'
import { SearchPalette } from './SearchPalette'

/**
 * The first component test in the desktop client.
 *
 * `vitest.config.ts` already carried the comment that it inlines Primer "which
 * is what any test importing a component that uses Primer needs" — the
 * configuration was prepared for these and none were ever written. The mobile
 * client got four screen tests before this one existed, which is the wrong way
 * round: this is the primary client.
 *
 * The debounce is real here rather than faked, because the bug worth guarding
 * lives in it. `searching` is set when a search starts and cleared by the
 * request's own `.finally` — the callback that does *not* run when the effect is
 * cancelled. Clearing the box mid-debounce and closing the palette mid-search
 * both took that path, and both left the flag set: a spinner that outlived its
 * search, and — because the same flag decides whether to say "no results" — a
 * screen that never told you nothing had matched.
 */

// Testing Library unmounts between tests by registering its own `afterEach`,
// which it can only do when the runner's globals are on. This config leaves
// them off, so each render stayed in the document and the second test found two
// of everything.
afterEach(cleanup)

// jsdom has neither. `useThumb` makes an object URL for every photo result, and
// without these its effect rejects rather than rendering.
beforeEach(() => {
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:test')
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
})

const openPalette = async () => {
  const view = render(
    <AppProvider>
      <SearchPalette />
    </AppProvider>,
  )
  // The global shortcut, which is how a person opens it — a palette only
  // reachable from one screen would not be a palette.
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  await waitFor(() => expect(view.getByPlaceholderText(/Search photos and files/)).toBeTruthy())
  return view
}

const fieldOf = (view: ReturnType<typeof render>) =>
  view.getByPlaceholderText(/Search photos and files/) as HTMLInputElement

describe('SearchPalette', () => {
  it('opens on the global shortcut rather than only from a screen', async () => {
    const view = await openPalette()
    expect(fieldOf(view)).toBeTruthy()
  })

  it('says what to do before anything is typed', async () => {
    const view = await openPalette()
    expect(view.getByText(/Type to search/)).toBeTruthy()
  })

  it('reports that nothing matched, rather than an empty panel', async () => {
    const view = await openPalette()
    fireEvent.change(fieldOf(view), { target: { value: 'zzzznotfound' } })

    await waitFor(() => expect(view.getByText(/Nothing matched/)).toBeTruthy(), { timeout: 2000 })
  })

  it('does not leave a spinner behind when the query is cleared mid-search', async () => {
    // The bug: `searching` goes up when the search starts and comes down in the
    // request's `.finally`, which cancellation skips. Clearing the box inside
    // the debounce used to leave it up for good.
    const view = await openPalette()
    fireEvent.change(fieldOf(view), { target: { value: 'a' } })
    fireEvent.change(fieldOf(view), { target: { value: '' } })

    await waitFor(() => expect(view.getByText(/Type to search/)).toBeTruthy())
    expect(view.queryByText(/Searching/)).toBeNull()
  })

  it('does not leave a spinner behind when the palette is closed mid-search', async () => {
    // The worse of the two: this one showed a spinner the *next* time the
    // palette was opened, before a character had been typed.
    const view = await openPalette()
    fireEvent.change(fieldOf(view), { target: { value: 'a' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByPlaceholderText(/Search photos and files/)).toBeNull())

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(view.getByPlaceholderText(/Search photos and files/)).toBeTruthy())
    expect(view.queryByText(/Searching/)).toBeNull()
  })
})
