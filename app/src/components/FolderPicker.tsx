import { useState } from 'react'
import { pickFolder } from '../native/bridge'
import { IconBadge } from './Icon'

/**
 * "Where are your photos?" — the step after choosing to hand a module to the
 * OS. The path is typed or browsed to; browsing goes through the native bridge,
 * which falls back to a plain prompt in a browser (see native/bridge.ts).
 */
export function FolderPicker({
  title,
  body,
  initial,
  placeholder,
  onConfirm,
  onBack,
}: {
  title: string
  body: string
  initial: string
  placeholder: string
  onConfirm: (path: string) => void
  onBack: () => void
}) {
  const [path, setPath] = useState(initial)

  const browse = async () => {
    const picked = await pickFolder(initial)
    if (picked) setPath(picked)
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'var(--surf2)',
        padding: 40,
      }}
    >
      <IconBadge name="folder" size={26} />

      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--tx2)', maxWidth: 320, lineHeight: 1.5 }}>{body}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 360 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={path}
            placeholder={placeholder}
            onChange={(e) => setPath(e.target.value)}
            aria-label={title}
          />
          <button className="btn" onClick={browse} style={{ whiteSpace: 'nowrap' }}>
            Browse…
          </button>
        </div>
        <button className="btn btn--primary" onClick={() => onConfirm(path)} style={{ padding: '11px 20px' }}>
          Confirm folder →
        </button>
      </div>

      <button className="btn--link" onClick={onBack} style={{ fontSize: 12, color: 'var(--txm)' }}>
        ← Back
      </button>
    </div>
  )
}
