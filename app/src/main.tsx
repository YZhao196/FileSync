import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Order matters: the font faces, then BuildNexus's tokens, then its Primer
// stylesheet (which remaps Primer's own variables onto those tokens), then the
// app's bridge, then the app's own base styles.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/buildnexus.css'
import './styles/theme.css'
import './styles/base.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
