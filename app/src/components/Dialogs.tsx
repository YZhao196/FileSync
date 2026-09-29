import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActionList, Button, ConfirmationDialog, Dialog, FormControl, TextInput } from '@primer/react'
import type { Album } from '../core/types'

/**
 * The small set of modal surfaces the app needs.
 *
 * There are four: confirm a destructive act, type a name, choose an album, and
 * show a share link. They share one frame rather than one per screen, because
 * two screens already need all four and a third copy of "overlay + card" is
 * where a UI starts drifting.
 *
 * The frame is BuildNexus `Dialog`, which brings the scrim, the focus trap, the
 * Escape handling and the close button the hand-rolled card carried itself.
 */

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * Kept so existing callers keep compiling. `Dialog` names itself from `title`
   * — it points `aria-labelledby` at the title element it renders — so no
   * caller-supplied id is needed any more.
   */
  labelledBy?: string
}) {
  return (
    <Dialog title={title} width={400} onClose={() => onClose()}>
      {children}
    </Dialog>
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
    <ConfirmationDialog
      title={title}
      width={400}
      // `ConfirmationDialog` reports the gesture; only "confirm" is the
      // destructive act, every other gesture (cancel, escape, close) cancels.
      onClose={(gesture) => (gesture === 'confirm' ? onConfirm() : onCancel())}
      confirmButtonContent={confirmLabel}
      cancelButtonContent="Cancel"
      confirmButtonType={danger ? 'danger' : 'primary'}
    >
      {body}
    </ConfirmationDialog>
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
    <Dialog
      title={title}
      width={400}
      onClose={() => onCancel()}
      initialFocusRef={inputRef}
      footerButtons={[
        { content: 'Cancel', onClick: onCancel },
        { content: submitLabel, buttonType: 'primary', onClick: submit, disabled: !value.trim() },
      ]}
    >
      <FormControl>
        <FormControl.Label>{label}</FormControl.Label>
        <TextInput
          ref={inputRef}
          block
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {hint && <FormControl.Caption>{hint}</FormControl.Caption>}
      </FormControl>
    </Dialog>
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
        <p className="body-01" style={{ color: 'var(--text-helper)' }}>
          Loading albums…
        </p>
      ) : !albums?.length ? (
        <p className="body-01" style={{ color: 'var(--text-helper)' }}>
          No albums on the server yet.
        </p>
      ) : (
        <ActionList>
          {albums.map((a) => (
            <ActionList.Item key={a.id} onSelect={() => onPick(a)}>
              <ActionList.LeadingVisual>
                <span
                  aria-hidden="true"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 'var(--border-radius-small)',
                    background: `linear-gradient(145deg, ${a.gradient[0]}, ${a.gradient[1]})`,
                  }}
                />
              </ActionList.LeadingVisual>
              {a.name}
              <ActionList.TrailingVisual>{a.count}</ActionList.TrailingVisual>
            </ActionList.Item>
          ))}
        </ActionList>
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
        <p className="body-01" style={{ color: 'var(--text-helper)' }}>
          Asking the server for a link…
        </p>
      ) : error ? (
        <p className="body-01" style={{ color: 'var(--text-error)' }}>
          {error}
        </p>
      ) : (
        <>
          <code
            className="code-01"
            style={{
              display: 'block',
              color: 'var(--text-secondary)',
              background: 'var(--layer-01)',
              padding: 'var(--spacing-03) var(--spacing-04)',
              borderRadius: 'var(--border-radius-medium)',
              wordBreak: 'break-all',
            }}
          >
            {link}
          </code>
          <div style={{ display: 'flex', gap: 'var(--spacing-03)', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
