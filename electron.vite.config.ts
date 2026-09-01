import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // better-sqlite3 is a NATIVE module: a compiled .node binary that Rollup
  // cannot bundle and must be `require`d from node_modules at runtime
  // (ADR-0007, ADR-0013). externalizeDepsPlugin leaves every `dependencies`
  // entry external in the main/preload builds, which is the electron-vite
  // idiom for exactly this.
  //
  // The RENDERER deliberately does not get this plugin: it bundles everything
  // (react, three, zustand, the occt wasm) so the packaged app needs nothing
  // from node_modules — and `core/` must stay DB-free, so nothing in the
  // renderer may reach better-sqlite3 in the first place. Storage is reached
  // over IPC.
  //
  // occt-import-js is the one `dependencies` entry the MAIN build must NOT
  // externalize (ADR-0029 phase 1). Packaging deletes the node_modules copy of
  // its glue and wasm — the shipped copies are the ones vite emitted for the
  // renderer (electron-builder.yml says why: the wasm exclusion there is
  // ADR-0011 compliance) — so a `require('occt-import-js')` from out/main would
  // resolve in dev and fail in the installed app. Bundling the glue into
  // out/main mirrors what the renderer already does with it and adds no
  // packaging path; the wasm stays the single shipped, replaceable file, found
  // at runtime by src/main/occt/wasmPath.ts.
  main: { plugins: [externalizeDepsPlugin({ exclude: ['occt-import-js', 'three'] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
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
