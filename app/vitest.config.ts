import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // jsdom for DOMParser (WebDAV XML) and anything touching window/navigator.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    server: {
      deps: {
        // Primer React imports its own .css. Vitest externalises node_modules
        // by default, which hands those imports to Node's ESM loader — and it
        // cannot open a .css file. Inlining lets Vite's pipeline handle them,
        // which is what any test importing a component that uses Primer needs.
        inline: ['@primer/react', '@primer/primitives', '@carbon/icons-react'],
      },
    },
  },
})
