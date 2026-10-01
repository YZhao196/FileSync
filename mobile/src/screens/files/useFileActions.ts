/**
 * What the file browser's actions do.
 *
 * Shaped like `usePhotoActions` on purpose — a `busy` flag, one `message`, one
 * `dismiss` — so a screen wires up the same way whichever library it is showing,
 * and there is one place per library that decides how a failure is worded.
 *
 * Rename is a move within one collection, which the shared `move` documents and
 * the shared `paths.ts` computes: `parentOf` and `joinPath` are the desktop's
 * own functions, so "rename" cannot come to mean something slightly different
 * on a phone. Reusing them also means the `/`-joining rules stay in one place,
 * which matters because the server is strict about `Destination` paths.
 *
 * Delete goes to Nextcloud's trash, not to gone — the same rule as photos, and
 * for the same reason.
 */

import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useCallback, useState } from 'react'
import { Alert } from 'react-native'

import type { FileEntry } from '../../core/types'
import { joinPath, parentOf } from '../../lib/paths'
import { blobToBytes } from '../../platform/blob'
import { useSession } from '../../state/session'

export interface FileActions {
  busy: boolean
  message: string | null
  dismiss: () => void
  download: (entry: FileEntry) => Promise<void>
  rename: (entry: FileEntry, nextName: string) => Promise<void>
  confirmDelete: (entry: FileEntry) => void
  createFolder: (directory: string, name: string) => Promise<void>
}

export function useFileActions(onChanged: () => void): FileActions {
  const { backends } = useSession()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = useCallback(
    async (work: () => Promise<string>) => {
      setBusy(true)
      try {
        setMessage(await work())
        onChanged()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'That did not work.')
      } finally {
        setBusy(false)
      }
    },
    [onChanged],
  )

  const download = useCallback(
    (entry: FileEntry) =>
      run(async () => {
        const blob = await backends.files.download(entry.path)
        const file = new File(Paths.cache, entry.name)
        file.create({ overwrite: true })
        file.write(await blobToBytes(blob))

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri)
          return `Saved ${entry.name}`
        }
        return `${entry.name} written to the app's cache`
      }),
    [backends, run],
  )

  const rename = useCallback(
    (entry: FileEntry, nextName: string) =>
      run(async () => {
        await backends.files.move(entry.path, joinPath(parentOf(entry.path), nextName))
        return `Renamed to ${nextName}`
      }),
    [backends, run],
  )

  const createFolder = useCallback(
    (directory: string, name: string) =>
      run(async () => {
        await backends.files.mkdir(joinPath(directory, name))
        return `Created ${name}`
      }),
    [backends, run],
  )

  const confirmDelete = useCallback(
    (entry: FileEntry) => {
      Alert.alert(
        `Delete ${entry.name}?`,
        entry.isFolder
          ? 'The folder and everything in it goes to Nextcloud’s trash.'
          : 'It goes to Nextcloud’s trash and can be restored there for the retention period.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => void run(async () => {
              await backends.files.remove(entry.path)
              return `Deleted ${entry.name}`
            }),
          },
        ],
      )
    },
    [backends, run],
  )

  return { busy, message, dismiss: () => setMessage(null), download, rename, confirmDelete, createFolder }
}
