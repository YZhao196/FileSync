import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { hydrateThumbs } from './lib/thumbCache'
// Order matters: the font faces, then BuildNexus's tokens, then its Primer
// stylesheet (which remaps Primer's own variables onto those tokens), then our
// patches for the gaps in that remap, then the application base.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/buildnexus.css'
import './styles/buildnexus-overrides.css'
import './styles/base.css'

// Seed the thumbnail counters from what is already on disk, so Settings
// reports the real cache size rather than this session's share of it.
void hydrateThumbs()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
