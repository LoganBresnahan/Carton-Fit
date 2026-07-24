import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    // Relative base so hashed assets (incl. the occt .wasm) resolve under the
    // packaged app's file:// origin, not just the dev server's http root.
    base: './',
    // occt runs in a module worker that uses ESM `import`; the default 'iife'
    // worker format can't. ADR-0002.
    worker: { format: 'es' }
  }
})
