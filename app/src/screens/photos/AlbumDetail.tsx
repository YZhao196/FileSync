import { Icon } from '../../components/Icon'
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
    () => (albumId ? backends.photos.albumAssets(albumId) : Promise.resolve([])),
    [backends, albumId],
  )

  if (!albumId) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button className="btn" onClick={() => go('albums')}>
          Back to albums
        </button>
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
        <button
          className="btn--link"
          onClick={() => go('albums')}
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Icon name="back" size={12} />
          {nav.albumName ?? 'Albums'}
        </button>
      }
    />
  )
}
