import { Blankslate } from '@primer/react/experimental'
import { Icon } from '../../components/Icon'
import { useAsync } from '../../hooks/useAsync'
import { useApp } from '../../state/store'

export function Albums() {
  const { backends, go } = useApp()
  const { data: albums, loading, error } = useAsync(() => backends.photos.albums(), [backends])

  if (loading) {
    return <Centered>Loading albums…</Centered>
  }

  if (error) {
    return (
      <Centered>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-02)',
            color: 'var(--text-error)',
          }}
        >
          <Icon name="alert" size={16} filled />
          {error}
        </span>
      </Centered>
    )
  }

  if (!albums?.length) {
    return (
      <Centered>
        <Blankslate>
          <Blankslate.Visual>
            <Icon name="folder-list" size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>No albums yet</Blankslate.Heading>
          <Blankslate.Description>Create one in Immich and it appears here.</Blankslate.Description>
        </Blankslate>
      </Centered>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: 'var(--spacing-06)' }}>
      <h1 className="heading-04" style={{ color: 'var(--text-primary)', marginBottom: 'var(--spacing-05)' }}>
        Albums
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--spacing-05)' }}>
        {albums.map((album) => (
          <button
            key={album.id}
            className="albumcard"
            onClick={() => go('album', { albumId: album.id, albumName: album.name })}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              padding: 'var(--spacing-03)',
              background: 'var(--layer-01)',
              border: '1px solid var(--border-subtle-01)',
              borderRadius: 'var(--border-radius-medium)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                height: 140,
                borderRadius: 'var(--border-radius-medium)',
                background: `linear-gradient(145deg, ${album.gradient[0]}, ${album.gradient[1]})`,
              }}
            />
            <div
              className="heading-compact-01"
              style={{ marginTop: 'var(--spacing-03)', color: 'var(--text-primary)' }}
            >
              {album.name}
            </div>
            <div className="label-01" style={{ color: 'var(--text-secondary)' }}>
              {album.count} item{album.count === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="body-compact-01"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-helper)',
        padding: 'var(--spacing-06)',
      }}
    >
      {children}
    </div>
  )
}
