import { useBackupWatch } from './hooks/useBackupWatch'
import { LeanCorner } from './components/LeanCorner'
import { SearchPalette } from './components/SearchPalette'
import { USING_MOCK } from './core/client'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/Toaster'
import { FirstRun } from './screens/FirstRun'
import { Provision } from './screens/Provision'
import { ReplaceServer } from './screens/ReplaceServer'
import { Settings } from './screens/Settings'
import { ServerStatus } from './screens/ServerStatus'
import { FilesBrowser } from './screens/files/FilesBrowser'
import { AlbumDetail } from './screens/photos/AlbumDetail'
import { Albums } from './screens/photos/Albums'
import { PhotosTimeline } from './screens/photos/PhotosTimeline'
import { AppProvider, useApp, type Screen } from './state/store'

function ScreenRouter({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'first-run':
      return <FirstRun />
    case 'timeline':
      return <PhotosTimeline />
    case 'albums':
      return <Albums />
    case 'album':
      return <AlbumDetail />
    case 'files':
      return <FilesBrowser />
    case 'server':
      return <ServerStatus />
    case 'settings':
      return <Settings />
    case 'replace-server':
      return <ReplaceServer />
    case 'provision':
      return <Provision />
  }
}

function Shell() {
  const { screen, backends } = useApp()

  // Warning about a fabricated backup would be the most misleading thing this
  // app could do, so the watcher stays off while a development build is on mocks.
  useBackupWatch(backends, !USING_MOCK)

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--layer-01)',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar />
        <main
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--layer-01)',
          }}
        >
          {/* Screens position themselves absolutely, so this is the containing
              block they fill. */}
          <ScreenRouter screen={screen} />
          <LeanCorner />
          <SearchPalette />
        </main>
      </div>
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  )
}
