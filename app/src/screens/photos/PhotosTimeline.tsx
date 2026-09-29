import { Button } from '@primer/react'
import { ChoiceScreen } from '../../components/ChoiceScreen'
import { FolderPicker } from '../../components/FolderPicker'
import { carbonIcon, Icon, IconBadge } from '../../components/Icon'
import { useToast } from '../../components/Toaster'
import { useAsync } from '../../hooks/useAsync'
import { FILE_MANAGER } from '../../lib/platform'
import { revealInSystem } from '../../native/bridge'
import { useApp } from '../../state/store'
import { PhotoCollection } from './PhotoCollection'

/**
 * The photo timeline, and the two ways of handing the library to the OS.
 *
 * The grid itself lives in `PhotoCollection`, which Albums, People and Places
 * also use — this screen owns only the module's mode and the timeline's fetch.
 */
export function PhotosTimeline() {
  const { photoMode, setPhotoMode, photoFolder, setPhotoFolder, isHost } = useApp()

  if (photoMode === 'choose') {
    return (
      <ChoiceScreen
        choices={[
          {
            icon: 'image',
            title: 'Browse photos in-app',
            body: 'View and manage your Immich library directly inside FileSynapse.',
            actionLabel: 'Open photo browser',
            primary: true,
            onAction: () => setPhotoMode('inapp'),
          },
          {
            icon: 'folder',
            title: 'Open local storage folder',
            body: `Browse the photos directory in ${FILE_MANAGER}.`,
            actionLabel: (
              <>
                {`Open in ${FILE_MANAGER}`}
                <Icon name="external" size={12} />
              </>
            ),
            onAction: () => setPhotoMode(isHost ? 'native-pick' : 'native'),
          },
        ]}
      />
    )
  }

  if (photoMode === 'native-pick') {
    return (
      <FolderPicker
        title="Where are your photos?"
        body="Select the local folder FileSynapse should watch. This folder will open in your system viewer when you browse photos."
        initial={photoFolder}
        placeholder="~/Pictures"
        onConfirm={(p) => {
          setPhotoFolder(p)
          setPhotoMode('native')
        }}
        onBack={() => setPhotoMode('choose')}
      />
    )
  }

  if (photoMode === 'native') {
    return (
      <NativeFolder
        path={photoFolder}
        onChange={() => setPhotoMode('native-pick')}
        onReset={() => setPhotoMode('choose')}
      />
    )
  }

  return <Timeline onReset={() => setPhotoMode('choose')} />
}

function NativeFolder({
  path,
  onChange,
  onReset,
}: {
  path: string
  onChange: () => void
  onReset: () => void
}) {
  const { show } = useToast()
  const { isHost } = useApp()

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)' }}>
      <div
        style={{
          width: 380,
          background: 'var(--layer-01)',
          border: '1px solid var(--border-subtle-01)',
          borderRadius: 'var(--border-radius-large)',
          padding: 'var(--spacing-06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-04)',
        }}
      >
        <IconBadge name="folder" size={26} />
        <div className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>
          Photos open in your system viewer
        </div>
        <div className="body-01" style={{ color: 'var(--text-secondary)' }}>
          {`Nothing is browsed in-app. The folder below is handed to ${FILE_MANAGER}.`}
        </div>
        <code
          className="code-01"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--layer-02)',
            padding: 'var(--spacing-02) var(--spacing-03)',
            borderRadius: 'var(--border-radius-medium)',
          }}
        >
          {path}
        </code>
        <div style={{ display: 'flex', gap: 'var(--spacing-03)', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            trailingVisual={carbonIcon('external')}
            onClick={async () => {
              const ok = await revealInSystem(path)
              if (!ok) show('Opening a folder needs the desktop shell — see for-human.md')
            }}
          >
            {`Open in ${FILE_MANAGER}`}
          </Button>
          {isHost && (
            <Button variant="default" onClick={onChange}>
              Change location
            </Button>
          )}
          <Button variant="default" onClick={onReset}>
            Use in-app viewer
          </Button>
        </div>
      </div>
    </div>
  )
}

function Timeline({ onReset }: { onReset: () => void }) {
  const { backends } = useApp()
  const { data, loading, reload } = useAsync(() => backends.photos.list({ page: 1 }), [backends])

  return (
    <PhotoCollection
      photos={data}
      loading={loading}
      backend={backends.photos}
      onChanged={reload}
      empty="No photos yet. Uploads from your phone appear here."
      leading={
        <Button variant="invisible" size="small" onClick={onReset} leadingVisual={carbonIcon('back')}>
          Change source
        </Button>
      }
    />
  )
}
