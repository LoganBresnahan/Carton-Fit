import type { ImportedPart } from '../workers/import-protocol'

// Main-thread import domain types (ADR-0002 phase 4). Kept separate from the
// worker protocol so the store and the pipeline share them without importing
// worker code, and free of any circular store↔pipeline dependency.

export type ImportStatus = 'idle' | 'parsing' | 'done' | 'failed'

export interface LoadedFile {
  name: string
  sizeBytes: number
}

/** Instrumentation captured per import (import-timing-instrumentation slice). */
export interface ImportStats {
  /** Wall-clock from worker dispatch to response, main-thread perceived. */
  elapsedMs: number
  partCount: number
  triangleCount: number
}

/** Where the pipeline writes its outcomes. The store implements this; tests
 *  pass spies. This is the injection seam that keeps dispatch logic out of the
 *  component and testable without a real Worker (ADR-0005 test pyramid). */
export interface ImportSink {
  begin(file: LoadedFile): void
  succeed(parts: ImportedPart[], stats: ImportStats): void
  fail(error: string): void
}
