import { useEffect, useState } from 'react'
import { Button, Text } from '@primer/react'
import { Modal } from '../../components/Dialogs'
import { Icon, carbonIcon } from '../../components/Icon'
import type { FileBackend } from '../../core/backends'
import type { FileEntry } from '../../core/types'

/**
 * Previews a file the app can actually render, and says so plainly when it
 * cannot.
 *
 * Only images and text are shown. A PDF, an archive or a spreadsheet gets an
 * honest "no preview" with the metadata and a Download button, rather than a
 * broken frame or a spinner that never resolves — pretending to preview is
 * worse than declining to.
 */
export function FilePreview({
  entry,
  backend,
  onClose,
  onDownload,
}: {
  entry: FileEntry
  backend: FileBackend
  onClose: () => void
  onDownload: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'unsupported'>('loading')

  const isImage = entry.mime?.startsWith('image/') ?? false
  const isText = (entry.mime?.startsWith('text/') || entry.mime === 'application/json') ?? false

  useEffect(() => {
    if (!entry.previewable || (!isImage && !isText)) {
      setState('unsupported')
      return
    }

    let cancelled = false
    let created: string | null = null

    backend
      .download(entry.path)
      .then(async (blob) => {
        if (cancelled) return
        if (isImage) {
          created = URL.createObjectURL(blob)
          setUrl(created)
        } else {
          setText(await blob.text())
        }
        if (!cancelled) setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [backend, entry.path, entry.previewable, isImage, isText])

  return (
    <Modal title={entry.name} onClose={onClose}>
      <div
        style={{
          minHeight: 200,
          maxHeight: '52vh',
          overflow: 'auto',
          background: 'var(--layer-02)',
          border: '1px solid var(--border-subtle-01)',
          borderRadius: 'var(--border-radius-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isText ? 'var(--spacing-03)' : 0,
        }}
      >
        {state === 'loading' && <Note text="Loading…" />}
        {state === 'failed' && <Note text="Could not read this file." danger />}
        {state === 'unsupported' && (
          <Note
            text={
              entry.isFolder
                ? 'Folders have no preview.'
                : `No preview for ${entry.typeLabel} files. Download it to open it in something that can.`
            }
          />
        )}
        {state === 'ready' && isImage && url && (
          <img src={url} alt={entry.name} style={{ maxWidth: '100%', maxHeight: '52vh', display: 'block' }} />
        )}
        {state === 'ready' && isText && text !== null && (
          <pre
            className="code-02"
            style={{
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
              width: '100%',
              textAlign: 'left',
            }}
          >
            {text.slice(0, 20_000)}
            {text.length > 20_000 && '\n\n… truncated at 20 000 characters.'}
          </pre>
        )}
      </div>

      <div className="label-01" style={{ display: 'flex', gap: 'var(--spacing-05)', color: 'var(--text-helper)', flexWrap: 'wrap' }}>
        <Text>{entry.typeLabel}</Text>
        {!entry.isFolder && <Text>{entry.sizeLabel}</Text>}
        <Text>Modified {entry.modifiedLabel}</Text>
        <Text className="code-01">{entry.path}</Text>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-03)', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>
          Close
        </Button>
        {!entry.isFolder && (
          <Button variant="primary" leadingVisual={carbonIcon('download')} onClick={onDownload}>
            Download
          </Button>
        )}
      </div>
    </Modal>
  )
}

function Note({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <div
      className="body-compact-01"
      style={{
        padding: 'var(--spacing-06)',
        color: danger ? 'var(--support-error)' : 'var(--text-helper)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--spacing-03)',
      }}
    >
      {/* Status colour carries a word here; the icon sits with it so the hue is
          never the only thing marking the state. */}
      {danger && <Icon name="alert" size={20} />}
      {text}
    </div>
  )
}
