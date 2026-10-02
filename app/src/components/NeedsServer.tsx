import { Button, Stack } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { Icon } from './Icon'
import { useApp } from '../state/store'

/**
 * Stands in for a screen that needs a server, while there is not one.
 *
 * These screens are reachable without a connection — the sidebar lists them
 * from the module mode, not from the connection — so each needs a state that
 * says so rather than an empty tree. See `backends` in the store for why there
 * is nothing to hand them.
 */
export function NeedsServer() {
  const { go } = useApp()

  return (
    <Stack
      direction="vertical"
      align="center"
      justify="center"
      gap="normal"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--background)',
        padding: 'var(--spacing-08)',
      }}
    >
      <Blankslate>
        <Blankslate.Visual>
          <Icon name="alert" size={24} />
        </Blankslate.Visual>
        <Blankslate.Heading>No server yet</Blankslate.Heading>
        <Blankslate.Description>
          FileSynapse has nothing to show until it knows where your server is.
        </Blankslate.Description>
      </Blankslate>
      <Button variant="primary" onClick={() => go('first-run')}>
        Set up a server
      </Button>
    </Stack>
  )
}
