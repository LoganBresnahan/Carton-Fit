import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Where the main process finds the OCCT WebAssembly binary (ADR-0029 phase 1,
// build-plan slice `node-occt-ingestion`).
//
// THE APP SHIPS EXACTLY ONE .wasm AND THIS MUST FIND THAT ONE. ADR-0011 makes
// the shipped binary replaceable by anyone who receives the app: it is emitted
// as a standalone hashed asset and kept OUT of app.asar (`asarUnpack` in
// electron-builder.yml), so substituting an own build of occt-import-js is a
// file copy. The renderer's import worker already loads that file. If the main
// process loaded a second, private copy instead, a recipient could replace the
// library and watch half the application go on using the old one — the LGPL
// guarantee would be quietly false. So main resolves the SAME file, and in a
// packaged build it resolves that file or nothing:
//
//   packaged   <app.asar>.unpacked/out/renderer/assets/occt-import-js-<hash>.wasm
//   built      out/renderer/assets/occt-import-js-<hash>.wasm   (npm run build)
//   dev        node_modules/occt-import-js/dist/occt-import-js.wasm
//
// The dev fallback exists because `electron-vite dev` serves the renderer from
// memory — out/renderer/assets is simply not on disk — and it is deliberately
// UNREACHABLE when packaged: falling back there would defeat the substitution
// above, and the packaging exclusions delete that copy anyway (so the fallback
// would fail at load rather than at resolution, which is a worse error).

/** Filesystem reads this module needs, injected so the packaged layout can be
 *  unit-tested without a packaged app. */
export interface WasmLookup {
  /** `.wasm` file names in `dir`, sorted; empty when the directory is absent. */
  listWasm(dir: string): string[]
  exists(file: string): boolean
}

export const nodeWasmLookup: WasmLookup = {
  listWasm(dir) {
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.wasm'))
        .sort()
    } catch {
      return []
    }
  },
  exists: (file) => existsSync(file)
}

/** Where the app's own files live: `app.getAppPath()` — the repo root when
 *  running from source, `…/resources/app.asar` when packaged. */
export interface OcctWasmContext {
  appPath: string
  isPackaged: boolean
}

/** The renderer-asset directory holding the shipped wasm, packaged or not.
 *  Packaged, that is the `.unpacked` sibling of the asar, because `asarUnpack`
 *  puts the file there — inside the archive there is nothing to find. */
export function occtAssetsDir({ appPath, isPackaged }: OcctWasmContext): string {
  const root = isPackaged ? `${appPath}.unpacked` : appPath
  return join(root, 'out', 'renderer', 'assets')
}

/**
 * Absolute path of the OCCT wasm, or throw naming everywhere that was looked.
 *
 * The hashed asset wins wherever it exists; the node_modules copy is a
 * source-tree convenience only. Several hashed wasm files in one directory
 * would mean a stale build sitting beside a fresh one, which is ambiguous
 * rather than recoverable — say so instead of picking one.
 */
export function resolveOcctWasm(
  context: OcctWasmContext,
  lookup: WasmLookup = nodeWasmLookup
): string {
  const assets = occtAssetsDir(context)
  const emitted = lookup.listWasm(assets)
  if (emitted.length > 1) {
    throw new Error(
      `expected one .wasm in ${assets}, found ${emitted.length} (${emitted.join(', ')}) — ` +
        'a stale build is beside a fresh one; rebuild rather than guessing'
    )
  }
  if (emitted.length === 1) return join(assets, emitted[0])

  if (context.isPackaged) {
    throw new Error(
      `the OpenCascade wasm is missing from the packaged app (looked in ${assets}). ` +
        'It ships unpacked beside app.asar (ADR-0011); the packaged build is incomplete.'
    )
  }

  const devCopy = join(
    context.appPath,
    'node_modules',
    'occt-import-js',
    'dist',
    'occt-import-js.wasm'
  )
  if (lookup.exists(devCopy)) return devCopy

  throw new Error(
    `could not find the OpenCascade wasm — looked in ${assets} and at ${devCopy}. ` +
      'Run `npm run build` or `npm install`.'
  )
}
