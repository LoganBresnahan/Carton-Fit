import type { PackResult } from '../core/packing/types'

// Main-thread packing domain types (roadmap item 4), kept separate from the
// worker protocol so the store and the pipeline share them without importing
// worker code — the same split import/types.ts makes for the import side.

export type PackStatus = 'idle' | 'packing' | 'done' | 'failed'

/** Where the pack pipeline writes its outcomes. The store implements this;
 *  tests pass spies. The injection seam that keeps dispatch out of components. */
export interface PackSink {
  begin(): void
  succeed(result: PackResult, elapsedMs: number): void
  fail(error: string): void
}
