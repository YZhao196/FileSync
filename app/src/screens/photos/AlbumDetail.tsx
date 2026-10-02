import { Button } from '@primer/react'
import { carbonIcon } from '../../components/Icon'
import { NeedsServer } from '../../components/NeedsServer'
import { useAsync } from '../../hooks/useAsync'
import { useApp } from '../../state/store'
import { PhotoCollection } from './PhotoCollection'

/**
 * One album's contents.
 *
 * The album id arrives through navigation rather than a route parameter, so a
 * missing one means the screen was reached without navigating — going back is
 * the only sensible answer, and it is handled before any fetch.
 */
export function AlbumDetail() {
  const { backends, nav, go } = useApp()
  const albumId = nav.albumId

  const { data, loading, reload } = useAsync(
    () => (albumId && backends ? backends.photos.albumAssets(albumId) : Promise.resolve([])),
    [backends, albumId],
  )

  // Guarded here and in the callback: hooks cannot be skipped, so the null has
  // to be answered for in both places.
  if (!backends) return <NeedsServer />

  if (!albumId) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--background)',
        }}
      >
        <Button variant="default" onClick={() => go('albums')}>
          Back to albums
        </Button>
      </div>
    )
  }

  return (
    <PhotoCollection
      photos={data}
      loading={loading}
      backend={backends.photos}
      onChanged={reload}
      empty="This album is empty."
      leading={
        <Button
          variant="invisible"
          size="small"
          onClick={() => go('albums')}
          leadingVisual={carbonIcon('back')}
        >
          {nav.albumName ?? 'Albums'}
        </Button>
      }
    />
  )
}
