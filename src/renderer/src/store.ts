import { create } from 'zustand'
import type { ImportedPart } from './workers/import-protocol'
import type { ImportSink, ImportStats, ImportStatus, LoadedFile } from './import/types'

// The app's data spine (ADR-0006). Workers and the import pipeline write here;
// components subscribe to slices and stay thin. The import actions below are
// exactly the ImportSink contract, so the pipeline drives the store directly.

export type { LoadedFile } from './import/types'

interface AppState {
  status: ImportStatus
  file: LoadedFile | null
  parts: ImportedPart[]
  error: string | null
  stats: ImportStats | null

  // ImportSink — called by the pipeline.
  beginImport: (file: LoadedFile) => void
  importSucceeded: (parts: ImportedPart[], stats: ImportStats) => void
  importFailed: (error: string) => void
  resetImport: () => void
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  file: null,
  parts: [],
  error: null,
  stats: null,

  beginImport: (file) => set({ status: 'parsing', file, parts: [], error: null, stats: null }),
  importSucceeded: (parts, stats) => set({ status: 'done', parts, stats, error: null }),
  importFailed: (error) => set({ status: 'failed', error, parts: [], stats: null }),
  resetImport: () => set({ status: 'idle', file: null, parts: [], error: null, stats: null })
}))

/** Adapt the store's actions to the pipeline's ImportSink. */
export function storeImportSink(): ImportSink {
  return {
    begin: (file) => useAppStore.getState().beginImport(file),
    succeed: (parts, stats) => useAppStore.getState().importSucceeded(parts, stats),
    fail: (error) => useAppStore.getState().importFailed(error)
  }
}
