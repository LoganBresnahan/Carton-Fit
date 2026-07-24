import occtFactory, { type OcctModule } from 'occt-import-js'
// Vite emits the .wasm as a hashed asset and hands back a URL that resolves in
// dev (http), in the packaged app (file://), and inside a module worker — the
// three contexts ADR-0002's plan requires this seam to survive.
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'

let occtPromise: Promise<OcctModule> | null = null

/**
 * Lazily instantiate the OpenCascade WASM module, memoized so the ~11 MB binary
 * is fetched and compiled at most once per worker. `locateFile` is the only
 * wiring that matters: Emscripten calls it to find the .wasm, and we point it at
 * the Vite-emitted URL rather than letting it guess a path relative to the glue.
 */
export function loadOcct(): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = occtFactory({ locateFile: () => wasmUrl })
  }
  return occtPromise
}
