import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { buildIdFrom, treeIsDirty } from './src/main/mcp/buildId'

// WHICH BUILD THIS IS (ADR-0029 slice `one-version-handshake`, ADR-0027's
// rule). The MCP handshake has to distinguish a release from a build that
// merely still carries the last release's number — the same distinction
// `/deploy` puts in an installer's filename. The RULE lives in
// src/main/mcp/buildId.ts (pure, and unit-tested there); this is only the part
// that has to ask git, which is possible at build time and not at runtime.
//
// Never throws. A build outside a git checkout — an exported tarball, a
// vendored copy — has nothing truthful to say, and `buildIdFrom` answers that
// with an empty suffix rather than a guess.
//
// ASKED ONCE, at module load, and the answer reused (BUILD_ID below). Two calls
// during one build CAN disagree — the second reading of the tree happens after
// vite has cleaned up the transient config file the first reading saw — and a
// build whose bundle and whose manifest name it differently is worse than
// either answer alone.
function gitBuildId(): string {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    return buildIdFrom({
      version,
      sha: git('rev-parse', '--short', 'HEAD'),
      dirty: treeIsDirty(git('status', '--porcelain')),
      tags: git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean)
    })
  } catch {
    return ''
  }
}

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

// The same id, written beside the bundle so a test can read what was built
// rather than re-deriving it from a repo that may have moved on. Same idea as
// bundled-modules.json: what shipped is a fact about the build, not something
// to recompute later and hope it matches.
function buildIdManifest(): Plugin {
  return {
    name: 'build-id-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-id.json',
        source: JSON.stringify({ buildId: BUILD_ID }, null, 2) + '\n'
      })
    }
  }
}

/** This build's identity, computed once. Everything below reads this. */
const BUILD_ID = gitBuildId()

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
    // The one build-time constant in the app. Injected into MAIN alone,
    // because main is the only process that answers the "which build?"
    // question — the renderer shows no version at all (ADR-0027's revisit
    // trigger).
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
    plugins: [
      externalizeDepsPlugin({ exclude: ['occt-import-js', 'three'] }),
      buildIdManifest(),
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
