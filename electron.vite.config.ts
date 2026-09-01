import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Which node_modules packages were BUNDLED into out/main, written to
// out/main/bundled-modules.json. This is licence bookkeeping, not build
// tooling: bundled code ships inside our own files, where no `LICENSE` sits
// beside it to satisfy THIRD-PARTY-NOTICES.md's claim — so every name in this
// manifest must appear in that file's table. `e2e/main-bundle-notices.spec.ts`
// enforces exactly that, which is what turns "the SDK upgrade started bundling
// a new package" from a silent licence violation into a red spec.
function bundledModulesManifest(): Plugin {
  return {
    name: 'bundled-modules-manifest',
    generateBundle(_options, bundle) {
      const packages = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of chunk.moduleIds) {
          const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id.replace(/\\/g, '/'))
          if (match) packages.add(match[1])
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'bundled-modules.json',
        source: JSON.stringify([...packages].sort(), null, 2) + '\n'
      })
    }
  }
}

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
  //
  // @modelcontextprotocol/sdk is bundled for the OPPOSITE economics (ADR-0029
  // phase 3): as a shipped node_modules tree it is 62 packages / 26 MB, of
  // which a stdio server loads a handful — the rest is an HTTP transport stack
  // this app never opens. It sits in devDependencies, so externalizeDepsPlugin
  // never sees it and electron-builder never ships its tree; rollup bundles
  // exactly the modules the two entries below reach. What ends up bundled is
  // recorded by bundledModulesManifest() above, and every package it names owes
  // a THIRD-PARTY-NOTICES.md row. (zod stays a real dependency: schemas.ts
  // imports it directly, so it ships in node_modules with its LICENSE.)
  //
  // TWO ENTRIES, one build: `index` is the app, `mcp` is the headless server
  // (src/main/mcpEntry.ts) executed via ELECTRON_RUN_AS_NODE from the shipped
  // binary — which is why it must be its own file whose import graph never
  // touches 'electron'. Phase 5's --mcp shim grows out of that entry.
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['occt-import-js', 'three'] }),
      bundledModulesManifest()
    ],
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          mcp: 'src/main/mcpEntry.ts'
        }
      }
    }
  },
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
