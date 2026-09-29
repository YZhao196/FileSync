import type { ReactNode } from 'react'
import { IconBadge, type IconName } from './Icon'

export interface Choice {
  icon: IconName
  title: string
  body: string
  actionLabel: ReactNode
  onAction: () => void
  primary?: boolean
  footnote?: ReactNode
}

/**
 * The two-card "OR" layout used wherever a module asks where its content
 * should live: the app's own UI, or the OS. Shared by Photos and Files.
 */
export function ChoiceScreen({ choices }: { choices: [Choice, Choice] }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surf2)',
        overflow: 'auto',
        padding: 40,
        gap: 0,
      }}
    >
      <Card {...choices[0]} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '0 20px',
        }}
      >
        <div style={{ width: 1, height: 64, background: 'var(--bd)' }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--txd)',
            background: 'var(--surf2)',
            padding: '3px 7px',
          }}
        >
          OR
        </span>
        <div style={{ width: 1, height: 64, background: 'var(--bd)' }} />
      </div>
      <Card {...choices[1]} />
    </div>
  )
}

function Card({ icon, title, body, actionLabel, onAction, primary, footnote }: Choice) {
  return (
    <div
      style={{
        width: 290,
        background: 'var(--surf)',
        borderRadius: 12,
        border: '1px solid var(--bd)',
        padding: 26,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: 'var(--shadow-raised)',
      }}
    >
      <IconBadge name={icon} size={24} />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx)', lineHeight: 1.35 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.55 }}>{body}</div>
      <button
        className={primary ? 'btn btn--primary' : 'btn'}
        onClick={onAction}
        style={{ alignSelf: 'flex-start' }}
      >
        {actionLabel}
      </button>
      {footnote}
    </div>
  )
}
