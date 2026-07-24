import { create } from 'zustand'
import type { ImportedPart } from './workers/import-protocol'
import type { ImportSink, ImportStats, ImportStatus, LoadedFile } from './import/types'
import type { PackMode, QualityTier, Vec3 } from './core/packing/types'
import type { UnitSystem } from './core/units'
import { DEFAULT_MAX_WEIGHT_G, inToMm } from './core/units'

// The app's data spine (ADR-0006). Two slices: the import outcome (worker/pipeline
// writes it) and the packing settings (the inputs panel writes them, persisted to
// localStorage by hand — ADR-0006 bans state middleware, so no zustand/persist).

export type { LoadedFile } from './import/types'

/** All user-chosen packing inputs, in canonical units (mm, grams — ADR-0004). */
export interface PackingSettings {
  mode: PackMode
  tier: QualityTier
  /** Display unit only; storage is always mm/g. */
  unitSystem: UnitSystem
  /** Raw box dimensions the user typed (mm); interpreted as inner or outer per enterOuter. */
  boxDimsMm: Vec3
  /** When true, boxDimsMm are OUTER dims and inner = outer − 2×wall. */
  enterOuter: boolean
  wallMm: number
  clearancePartMm: number
  clearanceWallMm: number
  maxWeightG: number
  weightMode: 'direct' | 'density'
  partWeightG: number
  densityGPerCm3: number
}

const DEFAULT_SETTINGS: PackingSettings = {
  mode: 'fit-check',
  tier: 'fast',
  unitSystem: 'imperial', // ADR-0004: the likely audience works in inches/lb
  boxDimsMm: [inToMm(12), inToMm(12), inToMm(12)],
  enterOuter: false,
  wallMm: 0,
  clearancePartMm: 0,
  clearanceWallMm: 0,
  maxWeightG: DEFAULT_MAX_WEIGHT_G,
  weightMode: 'direct',
  partWeightG: 0,
  densityGPerCm3: 1.0
}

const SETTINGS_KEY = 'packaging-estimator:settings'

function loadSettings(): PackingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // localStorage unavailable (tests) or corrupt JSON — fall back to defaults.
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: PackingSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore: nothing to do if storage is unavailable
  }
}

/** Derived inner carton dimensions (mm), applying wall thickness when entering outer. */
export function innerCartonMm(s: PackingSettings): Vec3 {
  if (!s.enterOuter) return s.boxDimsMm
  const w = 2 * s.wallMm
  return [s.boxDimsMm[0] - w, s.boxDimsMm[1] - w, s.boxDimsMm[2] - w]
}

interface AppState {
  // --- import slice ---
  status: ImportStatus
  file: LoadedFile | null
  parts: ImportedPart[]
  error: string | null
  stats: ImportStats | null
  beginImport: (file: LoadedFile) => void
  importSucceeded: (parts: ImportedPart[], stats: ImportStats) => void
  importFailed: (error: string) => void
  resetImport: () => void

  // --- settings slice ---
  settings: PackingSettings
  updateSettings: (patch: Partial<PackingSettings>) => void
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
  resetImport: () => set({ status: 'idle', file: null, parts: [], error: null, stats: null }),

  settings: loadSettings(),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } }))
}))

// Persist settings whenever they change (the object identity changes on updateSettings).
useAppStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) saveSettings(state.settings)
})

/** Adapt the store's actions to the pipeline's ImportSink. */
export function storeImportSink(): ImportSink {
  return {
    begin: (file) => useAppStore.getState().beginImport(file),
    succeed: (parts, stats) => useAppStore.getState().importSucceeded(parts, stats),
    fail: (error) => useAppStore.getState().importFailed(error)
  }
}
