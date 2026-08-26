import { create } from 'zustand'
import type { ImportedPart } from './workers/import-protocol'
import type { ImportSink, ImportStats, ImportStatus, LoadedFile } from './import/types'
import type { ConfigurationSummary, EstimateRow } from '../../shared/storage'
import type { UpdateInfo } from '../../shared/update'
import type { PackMode, PackRequest, PackResult, QualityTier, Vec3 } from './core/packing/types'
import type { PackSink, PackStatus } from './packing/types'
import type { PartWeightOverrides } from './packing/kinds'
import type { UnitSystem, WeightUnit } from './core/units'
import { DEFAULT_MAX_WEIGHT_G, inToMm, legacyWeightUnit } from './core/units'

// The app's data spine (ADR-0006). Three slices: the import outcome (worker/
// pipeline writes it), the packing settings (the inputs panel writes them,
// persisted to localStorage by hand — ADR-0006 bans state middleware, so no
// zustand/persist), and the pack outcome (the pack pipeline writes it).

export type { LoadedFile } from './import/types'

/** 3D view selection: follow the estimate, or pin one of the two scenes. */
export type ViewMode = 'auto' | 'model' | 'packed'

/** Resolve the view actually shown. 'auto' prefers the packed carton once an
 *  estimate exists; with no estimate there is only the model to show. */
export function resolvedView(viewMode: ViewMode, hasResult: boolean): 'model' | 'packed' {
  if (viewMode === 'model') return 'model'
  if (viewMode === 'packed') return hasResult ? 'packed' : 'model'
  return hasResult ? 'packed' : 'model'
}

/** All user-chosen packing inputs, in canonical units (mm, grams — ADR-0004). */
export interface PackingSettings {
  mode: PackMode
  tier: QualityTier
  /** Length display unit only; storage is always mm/g. Weights have their own
   *  per-input units (ADR-0024). */
  unitSystem: UnitSystem
  /** Display unit for the max-package weight and everything spent against it. */
  maxWeightUnit: WeightUnit
  /** Display unit for per-part weights: the Per part field, the per-kind
   *  overrides panel, and the per-part export columns. */
  partWeightUnit: WeightUnit
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
  maxWeightUnit: 'lb',
  partWeightUnit: 'lb',
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

const SETTINGS_KEY = 'carton-fit:settings'

/** Merge a persisted settings blob over the defaults. A blob written before
 *  ADR-0024 has no weight units; they derive from its own toggle so the
 *  display stays exactly where that user left it. */
export function settingsFromStored(parsed: Partial<PackingSettings>): PackingSettings {
  const legacy = legacyWeightUnit(parsed.unitSystem === 'metric' ? 'metric' : 'imperial')
  return {
    ...DEFAULT_SETTINGS,
    maxWeightUnit: legacy,
    partWeightUnit: legacy,
    ...parsed
  }
}

function loadSettings(): PackingSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return settingsFromStored(JSON.parse(raw))
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
  /** SHA-256 of the imported file's bytes — history identity (ADR-0007). */
  contentHash: string | null
  importSucceeded: (
    parts: ImportedPart[],
    stats: ImportStats,
    contentHash: string | null
  ) => void
  importFailed: (error: string) => void
  resetImport: () => void

  // --- settings slice ---
  settings: PackingSettings
  updateSettings: (patch: Partial<PackingSettings>) => void

  /** Which part max-quantity replicates, or null for the whole file as one
   *  rigid unit (ADR-0003). Deliberately NOT in the persisted settings: a part
   *  name belongs to the loaded file, so it is cleared on every import rather
   *  than carried across sessions. */
  unitPartName: string | null
  setUnitPartName: (name: string | null) => void

  /** Per-kind weight overrides in grams (ADR-0018), keyed by the product name
   *  before our ordinal suffix. File-scoped for the same reason
   *  `unitPartName` is: a kind name belongs to the loaded file, and a
   *  persisted `bolt → 23 g` silently repricing next week's unrelated file
   *  would be corruption wearing a convenience's face. Cleared on import,
   *  absent from `settings`, and therefore never in a preset. */
  partWeightsG: PartWeightOverrides
  /** Set an override, or clear it back to the mode's answer with null. */
  setPartWeight: (kind: string, grams: number | null) => void
  /** Replace the whole map — used when undo/redo re-applies a snapshot. */
  setPartWeights: (overrides: PartWeightOverrides) => void
  /** Apply settings AND overrides as ONE store write.
   *
   *  Restoring a saved estimate touches both slices, and two writes are two
   *  subscription notifications — which is two entries on the undo stack, so
   *  the restore would cost two Ctrl+Z presses. ADR-0016 §2 says a restore is
   *  one step, and this is what makes that true. */
  restoreInputs: (settings: Partial<PackingSettings>, overrides: PartWeightOverrides) => void

  /** Which 3D view is showing (VISION: "toggle between model view and packed
   *  view"). 'auto' follows the estimate — the packed carton once one exists —
   *  while an explicit choice pins it, so inspecting the model does not get
   *  undone by the next re-pack. */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // --- pack slice ---
  packStatus: PackStatus
  packResult: PackResult | null
  /** The request that produced packResult — the packed 3D view draws its carton. */
  packRequest: PackRequest | null
  packError: string | null
  packElapsedMs: number | null
  // --- saved configurations slice (ADR-0007) ---
  /** Named presets, as listed by the main process. */
  configurations: ConfigurationSummary[]
  /** Estimates the user chose to keep, newest first (ADR-0016). */
  savedEstimates: EstimateRow[]
  /** Last storage failure, for surfacing rather than swallowing. */
  storageError: string | null
  setConfigurations: (configurations: ConfigurationSummary[]) => void
  setSavedEstimates: (savedEstimates: EstimateRow[]) => void
  setStorageError: (storageError: string | null) => void

  // --- header status area slice (ADR-0021) ---
  /**
   * How many storage failures have been REPORTED this session.
   *
   * Dismissal is keyed on this counter and never on the message text, and that
   * is the subtle half of ADR-0021 §10. Item 9's finding was that storage
   * failures had only ever reached `console.warn`, so "every estimate is
   * recorded" could quietly stop being true — silence read as success. A plain
   * dismiss button recreates that bug one click later. Worse, two consecutive
   * failed saves usually produce the IDENTICAL string, so keying on the message
   * would swallow the second one: precisely the case where the user has retried
   * and most needs to be told.
   */
  storageErrorSeq: number
  /** The occurrence the user dismissed; the banner shows past it. */
  dismissedStorageSeq: number
  dismissStorageError: () => void

  /** A newer published release, or null — see `shared/update.ts`. */
  updateAvailable: UpdateInfo | null
  setUpdateAvailable: (updateAvailable: UpdateInfo | null) => void
  /**
   * Session-scoped on purpose (ADR-0021 §9): the banner returns next launch.
   * Persisting it would grow the versioned localStorage surface ADR-0020
   * defined, to suppress a statement that is true.
   */
  updateDismissed: boolean
  dismissUpdate: () => void

  packBegan: () => void
  packSucceeded: (result: PackResult, request: PackRequest, elapsedMs: number) => void
  packFailed: (error: string) => void
}

/** Cleared pack state — a result belongs to the file and inputs that produced
 *  it, so any new import must drop it rather than show a stale estimate. */
const NO_PACK = {
  packStatus: 'idle' as PackStatus,
  packResult: null,
  packRequest: null,
  packError: null,
  packElapsedMs: null
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  file: null,
  parts: [],
  error: null,
  stats: null,
  contentHash: null,

  beginImport: (file) =>
    set({
      status: 'parsing',
      file,
      parts: [],
      error: null,
      stats: null,
      contentHash: null,
      unitPartName: null,
      partWeightsG: {},
      ...NO_PACK
    }),
  importSucceeded: (parts, stats, contentHash) =>
    set({ status: 'done', parts, stats, contentHash, error: null }),
  importFailed: (error) =>
    set({
      status: 'failed',
      error,
      parts: [],
      stats: null,
      contentHash: null,
      unitPartName: null,
      partWeightsG: {},
      ...NO_PACK
    }),
  resetImport: () =>
    set({
      status: 'idle',
      file: null,
      parts: [],
      error: null,
      stats: null,
      contentHash: null,
      unitPartName: null,
      partWeightsG: {},
      ...NO_PACK
    }),

  settings: loadSettings(),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  unitPartName: null,
  setUnitPartName: (unitPartName) => set({ unitPartName }),

  partWeightsG: {},
  setPartWeight: (kind, grams) =>
    set((s) => {
      // Clearing removes the key rather than storing a sentinel, so "has an
      // override" stays a plain `in` test everywhere downstream.
      const next = { ...s.partWeightsG }
      if (grams === null) delete next[kind]
      else next[kind] = grams
      return { partWeightsG: next }
    }),
  setPartWeights: (partWeightsG) => set({ partWeightsG }),
  restoreInputs: (patch, partWeightsG) =>
    set((s) => ({ settings: { ...s.settings, ...patch }, partWeightsG })),

  viewMode: 'auto',
  setViewMode: (viewMode) => set({ viewMode }),

  ...NO_PACK,
  configurations: [],
  savedEstimates: [],
  storageError: null,
  setConfigurations: (configurations) => set({ configurations, storageError: null }),
  setSavedEstimates: (savedEstimates) => set({ savedEstimates, storageError: null }),
  // Bumped only when a failure is REPORTED. Clearing is not an occurrence, so
  // a success between two failures cannot silently re-arm a dismissed banner —
  // only the next real failure does that.
  setStorageError: (storageError) =>
    set((s) => ({
      storageError,
      storageErrorSeq: storageError === null ? s.storageErrorSeq : s.storageErrorSeq + 1
    })),

  storageErrorSeq: 0,
  dismissedStorageSeq: 0,
  dismissStorageError: () => set((s) => ({ dismissedStorageSeq: s.storageErrorSeq })),

  updateAvailable: null,
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  updateDismissed: false,
  dismissUpdate: () => set({ updateDismissed: true }),

  packBegan: () => set({ packStatus: 'packing', packError: null }),
  packSucceeded: (packResult, packRequest, packElapsedMs) =>
    set({ packStatus: 'done', packResult, packRequest, packElapsedMs, packError: null }),
  packFailed: (packError) =>
    set({ ...NO_PACK, packStatus: 'failed', packError })
}))

// Persist settings whenever they change (the object identity changes on updateSettings).
useAppStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) saveSettings(state.settings)
})

/** Adapt the store's actions to the pipeline's ImportSink. */
export function storeImportSink(): ImportSink {
  return {
    begin: (file) => useAppStore.getState().beginImport(file),
    succeed: (parts, stats, contentHash) =>
      useAppStore.getState().importSucceeded(parts, stats, contentHash),
    fail: (error) => useAppStore.getState().importFailed(error)
  }
}

/** Adapt the store's actions to the pack pipeline's PackSink. */
export function storePackSink(): PackSink {
  return {
    begin: () => useAppStore.getState().packBegan(),
    succeed: (result, request, elapsedMs) =>
      useAppStore.getState().packSucceeded(result, request, elapsedMs),
    fail: (error) => useAppStore.getState().packFailed(error)
  }
}
