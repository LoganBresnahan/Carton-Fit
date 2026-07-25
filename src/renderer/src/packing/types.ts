import type { PackRequest, PackResult } from '../core/packing/types'

// Main-thread packing domain types (roadmap item 4), kept separate from the
// worker protocol so the store and the pipeline share them without importing
// worker code — the same split import/types.ts makes for the import side.

export type PackStatus = 'idle' | 'packing' | 'done' | 'failed'

/** Where the pack pipeline writes its outcomes. The store implements this;
 *  tests pass spies. The injection seam that keeps dispatch out of components. */
export interface PackSink {
  begin(): void
  /** The REQUEST comes back with the result deliberately: the packed 3D view
   *  needs the carton those placements sit in, and reading it from live settings
   *  would draw a box that disagrees with the placements during the debounce
   *  window. Pairing them also gives estimate history (item 7) a self-contained
   *  record, without putting presentation state on the engine contract. */
  succeed(result: PackResult, request: PackRequest, elapsedMs: number): void
  fail(error: string): void
}
