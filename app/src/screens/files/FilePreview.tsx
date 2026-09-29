import { useEffect, useState } from 'react'
import { Modal } from '../../components/Dialogs'
import { Icon } from '../../components/Icon'
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
          background: 'var(--surf2)',
          border: '1px solid var(--bd)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isText ? 12 : 0,
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
            className="mono"
            style={{
              fontSize: 12,
              color: 'var(--tx)',
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

      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--txm)', flexWrap: 'wrap' }}>
        <span>{entry.typeLabel}</span>
        {!entry.isFolder && <span>{entry.sizeLabel}</span>}
        <span>Modified {entry.modifiedLabel}</span>
        <span className="mono">{entry.path}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>
          Close
        </button>
        {!entry.isFolder && (
          <button className="btn btn--primary" onClick={onDownload}>
            <Icon name="download" size={12} />
            Download
          </button>
        )}
      </div>
    </Modal>
  )
}

function Note({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <div style={{ padding: 24, fontSize: 13, color: danger ? 'var(--danger)' : 'var(--txm)', textAlign: 'center' }}>
      {text}
    </div>
  )
}
