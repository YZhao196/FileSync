import { useEffect, useMemo, useState } from 'react'
import { ChoiceScreen } from '../../components/ChoiceScreen'
import { ConfirmDialog, PromptDialog } from '../../components/Dialogs'
import { FolderPicker } from '../../components/FolderPicker'
import { Icon, IconBadge, type IconName } from '../../components/Icon'
import { useToast } from '../../components/Toaster'
import type { FileEntry, TreeNode } from '../../core/types'
import { useAsync } from '../../hooks/useAsync'
import { joinPath, parentOf } from '../../lib/paths'
import { safeFilename } from '../../lib/photos'
import { FILE_MANAGER } from '../../lib/platform'
import { openExternal, revealInSystem, saveFile } from '../../native/bridge'
import { useApp } from '../../state/store'
import { FilePreview } from './FilePreview'

interface TreeRow extends TreeNode {
  depth: number
  hasChildren: boolean
  expanded: boolean
}

export function FilesBrowser() {
  const { fileMode, setFileMode, fileFolder, setFileFolder, isHost, nav } = useApp()

  // Arriving from a search result means the user has already chosen: they asked
  // for a specific file. Showing the in-app/explorer chooser in front of it
  // would answer a question they did not ask, so the module opens in-app.
  const arrivingAtFile = Boolean(nav.filePath)
  useEffect(() => {
    if (arrivingAtFile && fileMode === 'choose') setFileMode('inapp')
  }, [arrivingAtFile, fileMode, setFileMode])

  if (fileMode === 'choose') {
    return (
      <ChoiceScreen
        choices={[
          {
            icon: 'folder-list',
            title: 'Browse files in-app',
            body: 'Browse and manage your Nextcloud files directly inside FileSynapse.',
            actionLabel: 'Open file browser',
            primary: true,
            onAction: () => setFileMode('inapp'),
          },
          {
            icon: 'folder',
            title: 'Open in system explorer',
            body: `The Nextcloud drive is mounted locally. Use ${FILE_MANAGER} to browse it.`,
            actionLabel: (
              <>
                {`Open in ${FILE_MANAGER}`}
                <Icon name="external" size={12} />
              </>
            ),
            onAction: () => setFileMode(isHost ? 'native-pick' : 'native'),
          },
        ]}
      />
    )
  }

  if (fileMode === 'native-pick') {
    return (
      <FolderPicker
        title="Where are your files?"
        body="Select the local Nextcloud folder FileSynapse should open in your system explorer."
        initial={fileFolder}
        placeholder="~/Nextcloud"
        onConfirm={(p) => {
          setFileFolder(p)
          setFileMode('native')
        }}
        onBack={() => setFileMode('choose')}
      />
    )
  }

  if (fileMode === 'native') {
    return (
      <NativeFolder
        path={fileFolder}
        onChange={() => setFileMode('native-pick')}
        onReset={() => setFileMode('choose')}
      />
    )
  }

  return <Browser onReset={() => setFileMode('choose')} />
}

function NativeFolder({ path, onChange, onReset }: { path: string; onChange: () => void; onReset: () => void }) {
  const { show } = useToast()
  const { isHost } = useApp()

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surf2)' }}>
      <div
        style={{
          width: 380,
          background: 'var(--surf)',
          border: '1px solid var(--bd)',
          borderRadius: 12,
          padding: 26,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: 'var(--shadow-raised)',
        }}
      >
        <IconBadge name="folder" size={26} />
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx)' }}>
          {`Files open in ${FILE_MANAGER}`}
        </div>
        <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }}>
          The Nextcloud client keeps this folder in sync; FileSynapse simply hands it to the OS.
        </div>
        <code style={{ fontSize: 12, color: 'var(--tx2)', background: 'var(--surf2)', padding: '6px 10px', borderRadius: 6 }}>
          {path}
        </code>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn--primary"
            onClick={async () => {
              const ok = await revealInSystem(path)
              if (!ok) show('Opening a folder needs the desktop shell — see for-human.md')
            }}
          >
            {`Open in ${FILE_MANAGER}`}
            <Icon name="external" size={12} />
          </button>
          {isHost && (
            <button className="btn" onClick={onChange}>
              Change location
            </button>
          )}
          <button className="btn" onClick={onReset}>
            Use in-app browser
          </button>
        </div>
      </div>
    </div>
  )
}

/** What the browser is currently asking the user to confirm or type. */
type FileDialog =
  | { kind: 'preview'; entry: FileEntry }
  | { kind: 'newFolder' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entry: FileEntry }
  | null

function Browser({ onReset }: { onReset: () => void }) {
  const { backends, nav, connection } = useApp()
  const { show } = useToast()

  const { data: tree, reload: reloadTree } = useAsync(() => backends.files.tree(), [backends])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [currentPath, setCurrentPath] = useState(nav.filePath ?? '/')
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [dialog, setDialog] = useState<FileDialog>(null)
  const [busy, setBusy] = useState(false)

  // A search result navigates here with a folder in mind. Re-routing an already
  // mounted browser is the case that matters, so this watches rather than
  // reading the initial value only.
  useEffect(() => {
    if (nav.filePath) {
      setCurrentPath(nav.filePath)
      setSelected(null)
    }
  }, [nav.filePath])

  const { data: entries, loading: entriesLoading, reload: reloadEntries } = useAsync(
    () => backends.files.list(currentPath),
    [backends, currentPath],
  )

  const rows = useMemo(() => flatten(tree ?? [], expanded), [tree, expanded])

  const refresh = () => {
    reloadEntries()
    reloadTree()
  }

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const enter = (folder: string) => {
    setCurrentPath(folder)
    setSelected(null)
    setExpanded((prev) => new Set(prev).add(folder))
  }

  /** Double-click behaviour: folders open, files preview. */
  const open = (entry: FileEntry) => {
    if (entry.isFolder) enter(entry.path)
    else setDialog({ kind: 'preview', entry })
  }

  async function run(action: () => Promise<void>, success: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      show(success)
      refresh()
    } catch (e) {
      show(e instanceof Error ? `${e.message}` : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  const download = (entry: FileEntry) =>
    run(async () => {
      const blob = await backends.files.download(entry.path)
      const ok = await saveFile(safeFilename(entry.name), blob)
      if (!ok) throw new Error('Download cancelled')
    }, `Saved ${entry.name}`)

  const crumbs = currentPath.split('/').filter(Boolean)

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          height: 40,
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 7,
          flexShrink: 0,
        }}
      >
        <button className="btn btn--sm" disabled={busy} onClick={() => setDialog({ kind: 'newFolder' })}>
          + New folder
        </button>
        <button
          className="btn btn--sm"
          disabled={!selected || busy}
          onClick={() => selected && setDialog({ kind: 'preview', entry: selected })}
        >
          Preview
        </button>
        <button
          className="btn btn--sm"
          disabled={!selected || selected.isFolder || busy}
          onClick={() => selected && download(selected)}
        >
          <Icon name="download" size={12} />
          Download
        </button>
        <button
          className="btn btn--sm"
          disabled={!selected || busy}
          onClick={() => selected && setDialog({ kind: 'rename', entry: selected })}
        >
          Rename
        </button>
        <button
          className="btn btn--sm"
          disabled={!selected || busy}
          onClick={() => selected && setDialog({ kind: 'delete', entry: selected })}
          style={{ color: 'var(--danger)' }}
        >
          Delete
        </button>

        <div style={{ flex: 1 }} />

        {/* Uploading belongs to Nextcloud: background sync, conflict handling
            and resume are the hard parts, and they are solved there. This hands
            the folder over rather than growing a second uploader. */}
        <button
          className="btn--link"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={async () => {
            const base = connection.nextcloudUrl
            if (!base) {
              show('Uploading lives in Nextcloud — not connected to one yet')
              return
            }
            const url = `${base}/apps/files/?dir=${encodeURIComponent(currentPath)}`
            const ok = await openExternal(url)
            if (!ok) show('Uploading lives in Nextcloud — open the Nextcloud web UI')
          }}
        >
          Upload in Nextcloud
          <Icon name="external" size={12} />
        </button>
        <button
          className="btn--link"
          onClick={onReset}
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          Change source
          <Icon name="refresh" size={12} />
        </button>
      </div>

      <div
        style={{
          height: 30,
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 4,
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        <button className="btn--link" style={{ fontSize: 12 }} onClick={() => enter('/')}>
          {connection.address ? 'Nextcloud' : 'root'}
        </button>
        {crumbs.map((c, i) => {
          const path = `/${crumbs.slice(0, i + 1).join('/')}`
          return (
            <span key={path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--txd)' }}>›</span>
              <button className="btn--link" style={{ fontSize: 12 }} onClick={() => enter(path)}>
                {c}
              </button>
            </span>
          )
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 240, borderRight: '1px solid var(--bd)', overflowY: 'auto', padding: '6px 0' }} aria-label="Folders">
          {rows.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--txm)', fontSize: 12 }}>Loading…</div>
          ) : (
            rows.map((node) => (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (node.hasChildren) toggle(node.path)
                  if (node.isFolder) enter(node.path)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && node.isFolder) enter(node.path)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  paddingLeft: 8 + node.depth * 14,
                  borderRadius: 3,
                  cursor: 'pointer',
                  background: currentPath === node.path ? 'var(--accbg)' : 'transparent',
                  color: currentPath === node.path ? 'var(--acc)' : 'var(--tx)',
                  fontSize: 13,
                }}
              >
                <span style={{ width: 10, textAlign: 'center', fontSize: 10, color: 'var(--txd)' }}>
                  {node.hasChildren ? (node.expanded ? '▾' : '▸') : ''}
                </span>
                <Icon name={node.isFolder ? 'folder' : 'file'} size={13} style={{ color: 'var(--txm)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.name}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(150px, 1fr) 70px 92px 84px',
              padding: '6px 14px',
              background: 'var(--surf2)',
              borderBottom: '1px solid var(--bd)',
              position: 'sticky',
              top: 0,
            }}
          >
            {['Name', 'Size', 'Type', 'Modified'].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)' }}>
                {h}
              </span>
            ))}
          </div>

          {entriesLoading ? (
            <div style={{ padding: 14, color: 'var(--txm)', fontSize: 13 }}>Loading…</div>
          ) : !entries?.length ? (
            <div style={{ padding: 14, color: 'var(--txm)', fontSize: 13 }}>This folder is empty.</div>
          ) : (
            entries.map((f) => (
              <div
                key={f.path}
                role="button"
                tabIndex={0}
                aria-selected={selected?.path === f.path}
                // Click selects, double-click opens — the model Explorer and
                // Finder both use. Selecting on click is what makes Rename and
                // Delete reachable for a folder; opening on single click would
                // leave no way to act on one at all.
                onClick={() => setSelected(f)}
                onDoubleClick={() => open(f)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (f.isFolder) enter(f.path)
                  else setDialog({ kind: 'preview', entry: f })
                }}
                className="hoverable"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(150px, 1fr) 70px 92px 84px',
                  padding: '7px 14px',
                  borderBottom: '1px solid var(--bd)',
                  cursor: 'pointer',
                  alignItems: 'center',
                  background: selected?.path === f.path ? 'var(--accbg)' : undefined,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                  <Icon name={iconFor(f.name, f.isFolder)} size={15} style={{ color: 'var(--txm)' }} />
                  <span
                    style={{
                      fontSize: 13,
                      color: selected?.path === f.path ? 'var(--acc)' : 'var(--tx)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.name}
                  </span>
                </span>
                <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{f.sizeLabel}</span>
                <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{f.typeLabel}</span>
                <span style={{ fontSize: 13, color: 'var(--tx2)' }}>{f.modifiedLabel}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {dialog?.kind === 'preview' && (
        <FilePreview
          entry={dialog.entry}
          backend={backends.files}
          onClose={() => setDialog(null)}
          onDownload={() => download(dialog.entry)}
        />
      )}

      {dialog?.kind === 'newFolder' && (
        <PromptDialog
          title="New folder"
          label="Name"
          submitLabel="Create"
          hint={`Created in ${currentPath}`}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null)
            void run(
              () => backends.files.mkdir(joinPath(currentPath, name)),
              `Created ${name}`,
            )
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          label="New name"
          initial={dialog.entry.name}
          submitLabel="Rename"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const entry = dialog.entry
            setDialog(null)
            setSelected(null)
            void run(
              () => backends.files.move(entry.path, joinPath(parentOf(entry.path), name)),
              `Renamed to ${name}`,
            )
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.entry.name}?`}
          body={
            dialog.entry.isFolder
              ? 'The folder and everything inside it are removed from Nextcloud. Nextcloud keeps deleted files in its trash for a while, but nothing in this app can restore them.'
              : 'The file is removed from Nextcloud. Nextcloud keeps deleted files in its trash for a while, but nothing in this app can restore them.'
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const entry = dialog.entry
            setDialog(null)
            setSelected(null)
            void run(() => backends.files.remove(entry.path), `Deleted ${entry.name}`)
          }}
        />
      )}

    </div>
  )
}

export function flatten(nodes: TreeNode[], expanded: Set<string>, depth = 0): TreeRow[] {
  const out: TreeRow[] = []
  for (const node of nodes) {
    const hasChildren = Boolean(node.children?.length)
    const isExpanded = expanded.has(node.path)
    out.push({ ...node, depth, hasChildren, expanded: isExpanded })
    if (hasChildren && isExpanded) out.push(...flatten(node.children ?? [], expanded, depth + 1))
  }
  return out
}

export function iconFor(name: string, isFolder: boolean): IconName {
  if (isFolder) return 'folder'
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'file-image'
  if (/\.(md|txt|json|ts|tsx|js|css|html?)$/i.test(name)) return 'file-text'
  if (/\.(zip|tar|gz|7z|rar)$/i.test(name)) return 'archive'
  return 'file'
}
