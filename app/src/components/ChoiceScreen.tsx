import { Button, Stack } from '@primer/react'
import { Card } from '@primer/react/experimental'
import { carbonIcon, type IconName } from './Icon'

export interface Choice {
  icon: IconName
  title: string
  body: string
  actionLabel: React.ReactNode
  onAction: () => void
  primary?: boolean
  footnote?: React.ReactNode
}

/**
 * The two-card "OR" layout used wherever a module asks where its content
 * should live: the app's own UI, or the OS. Shared by Photos and Files.
 *
 * BuildNexus `Card`, laid out as a grid of equal widths. Only one of the two
 * actions is `primary` — the design system allows one primary button per view.
 */
export function ChoiceScreen({ choices }: { choices: [Choice, Choice] }) {
  return (
    <Stack
      direction="horizontal"
      align="center"
      justify="center"
      gap="none"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--background)',
        overflow: 'auto',
        padding: 'var(--spacing-08)',
      }}
    >
      {/* Cards flex rather than holding a fixed width: at a narrow window two
          320px cards overflow, and Primer's Card collapses its inner grid when
          squeezed, which puts the action above the text. */}
      <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 340 }}>
        <ChoiceCard {...choices[0]} />
      </div>
      <OrDivider />
      <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 340 }}>
        <ChoiceCard {...choices[1]} />
      </div>
    </Stack>
  )
}

function OrDivider() {
  return (
    <Stack direction="vertical" align="center" gap="condensed" style={{ padding: '0 var(--spacing-05)' }}>
      <div style={{ width: 1, height: 64, background: 'var(--border-subtle-01)' }} />
      <span
        className="label-01"
        style={{ color: 'var(--text-helper)', background: 'var(--background)', padding: '3px 7px' }}
      >
        OR
      </span>
      <div style={{ width: 1, height: 64, background: 'var(--border-subtle-01)' }} />
    </Stack>
  )
}

function ChoiceCard({ icon, title, body, actionLabel, onAction, primary, footnote }: Choice) {
  return (
    <div>
      <Card padding="normal" borderRadius="large">
        <Card.Icon icon={carbonIcon(icon)} />
        <Card.Heading as="h2">{title}</Card.Heading>
        <Card.Description>{body}</Card.Description>
        <Card.Action>
          <Button variant={primary ? 'primary' : 'default'} onClick={onAction}>
            {actionLabel}
          </Button>
        </Card.Action>
        {footnote}
      </Card>
    </div>
  )
}
