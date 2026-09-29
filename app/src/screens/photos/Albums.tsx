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
        <span style={{ color: 'var(--danger)' }}>{error}</span>
      </Centered>
    )
  }

  if (!albums?.length) {
    return <Centered>No albums yet. Create one in Immich and it appears here.</Centered>
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--tx)', marginBottom: 20 }}>Albums</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {albums.map((album) => (
          <button
            key={album.id}
            className="albumcard"
            onClick={() => go('album', { albumId: album.id, albumName: album.name })}
            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 8 }}
          >
            <div
              aria-hidden="true"
              style={{
                height: 140,
                borderRadius: 8,
                background: `linear-gradient(145deg, ${album.gradient[0]}, ${album.gradient[1]})`,
              }}
            />
            <div style={{ padding: '8px 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--tx)' }}>
              {album.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--txm)' }}>
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
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--txm)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  )
}
