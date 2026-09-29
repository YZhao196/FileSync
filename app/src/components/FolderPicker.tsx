import { useState } from 'react'
import { Button, FormControl, TextInput } from '@primer/react'
import { pickFolder } from '../native/bridge'
import { carbonIcon, IconBadge } from './Icon'

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
        gap: 'var(--spacing-06)',
        background: 'var(--layer-02)',
        padding: 'var(--spacing-07)',
      }}
    >
      <IconBadge name="folder" size={26} />

      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-03)' }}>
        <div className="heading-compact-02" style={{ color: 'var(--text-primary)' }}>{title}</div>
        <div className="body-compact-01" style={{ color: 'var(--text-secondary)', maxWidth: 320 }}>{body}</div>
      </div>

      {/* The label is visual-hidden because the step's own heading already names
          the field on screen; it stays as the input's accessible name. */}
      <FormControl
        id="folder-picker-path"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-03)', width: 360 }}
      >
        <FormControl.Label htmlFor="folder-picker-path" visuallyHidden>{title}</FormControl.Label>
        <div style={{ display: 'flex', gap: 'var(--spacing-03)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              id="folder-picker-path"
              block
              value={path}
              placeholder={placeholder}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <Button onClick={browse}>
            Browse…
          </Button>
        </div>
        <Button variant="primary" block onClick={() => onConfirm(path)}>
          Confirm folder
        </Button>
      </FormControl>

      <Button variant="link" size="small" leadingVisual={carbonIcon('back')} onClick={onBack}>
        Back
      </Button>
    </div>
  )
}
