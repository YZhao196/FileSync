import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Album } from '../core/types'
import { Icon } from './Icon'

/**
 * The small set of modal surfaces the app needs.
 *
 * There are four: confirm a destructive act, type a name, choose an album, and
 * show a share link. They share one frame rather than one per screen, because
 * two screens already need all four and a third copy of "overlay + card" is
 * where a UI starts drifting.
 */

export function Modal({
  title,
  onClose,
  children,
  labelledBy = 'modal-title',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  labelledBy?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(9,9,12,0.45)',
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        animation: 'fadeInFast 120ms ease',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--surf)',
          border: '1px solid var(--bd)',
          borderRadius: 12,
          padding: 22,
          boxShadow: 'var(--shadow-raised)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id={labelledBy} style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx)', flex: 1 }}>
            {title}
          </h2>
          <button className="btn--link" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }}>{body}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={danger ? 'btn btn--danger' : 'btn btn--primary'}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function PromptDialog({
  title,
  label,
  initial = '',
  submitLabel = 'Create',
  hint,
  onSubmit,
  onCancel,
}: {
  title: string
  label: string
  initial?: string
  submitLabel?: string
  hint?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <div>
        <label className="field-label" htmlFor="prompt-input" style={{ display: 'block', marginBottom: 6 }}>
          {label}
        </label>
        <input
          id="prompt-input"
          ref={inputRef}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {hint && (
          <div className="hint" style={{ marginTop: 6 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={!value.trim()}>
          {submitLabel}
        </button>
      </div>
    </Modal>
  )
}

export function AlbumPicker({
  albums,
  loading,
  count,
  onPick,
  onCancel,
}: {
  albums: Album[] | null
  loading: boolean
  count: number
  onPick: (album: Album) => void
  onCancel: () => void
}) {
  return (
    <Modal title={`Add ${count} item${count === 1 ? '' : 's'} to an album`} onClose={onCancel}>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--txm)' }}>Loading albums…</div>
      ) : !albums?.length ? (
        <div style={{ fontSize: 13, color: 'var(--txm)' }}>No albums on the server yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
          {albums.map((a) => (
            <button
              key={a.id}
              className="hoverable"
              onClick={() => onPick(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                textAlign: 'left',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 5,
                  flexShrink: 0,
                  background: `linear-gradient(145deg, ${a.gradient[0]}, ${a.gradient[1]})`,
                }}
              />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--tx)' }}>{a.name}</span>
              <span style={{ fontSize: 12, color: 'var(--txm)' }}>{a.count}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function ShareDialog({
  link,
  loading,
  error,
  onClose,
}: {
  link: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Clipboard access can be denied; the link is on screen either way.
      setCopied(false)
    }
  }

  return (
    <Modal title="Share link" onClose={onClose}>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--txm)' }}>Asking the server for a link…</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.55 }}>{error}</div>
      ) : (
        <>
          <code
            style={{
              fontSize: 12,
              color: 'var(--tx2)',
              background: 'var(--surf2)',
              padding: '8px 10px',
              borderRadius: 6,
              wordBreak: 'break-all',
            }}
          >
            {link}
          </code>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn btn--primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
