import { create } from 'zustand'
import type { ImportedPart } from './workers/import-protocol'
import type { ImportSink, ImportStats, ImportStatus, LoadedFile } from './import/types'
import type { ConfigurationSummary, EstimateRow } from '../../shared/storage'
import type { UpdateInfo } from '../../shared/update'
import type { PackRequest, PackResult } from './core/packing/types'
import type { PackSink, PackStatus } from './packing/types'
import type { PartWeightOverrides } from './packing/kinds'
import { clampPanelWidth, DEFAULT_PANEL_WIDTH } from './layout/panel-width'
// The packing inputs live in packing/settings.ts so the main process can share
// them (ADR-0029 phase 2); re-exported here because this is where the app has
// always imported them from.
import { DEFAULT_SETTINGS, settingsFromStored, type PackingSettings } from './packing/settings'
export {
  DEFAULT_SETTINGS,
  settingsFromStored,
  innerCartonMm,
  type PackingSettings
} from './packing/settings'

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

const SETTINGS_KEY = 'carton-fit:settings'

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

/** Layout preferences, in their OWN key outside `settings` (ADR-0026 §6).
 *  Presets and saved estimates serialize `settings` whole, so a width in
 *  there would be restored with a carton. A separate key needs no exclusion
 *  logic anywhere — it is simply not in the blob. Versioned surface per
 *  ADR-0020. */
const LAYOUT_KEY = 'carton-fit:layout'

/** The window width to clamp against, or NaN outside a DOM (unit tests) —
 *  clampPanelWidth reads that as "no window constraint". */
function currentWindowWidth(): number {
  return typeof window === 'undefined' ? NaN : window.innerWidth
}

/** Interpret a persisted layout blob. Split out from the storage read the way
 *  `settingsFromStored` is, so the rule that matters — what a missing, corrupt
 *  or wrong-typed width means — is testable without a DOM.
 *
 *  Anything that is not a number is the default, and a stale value from a wider
 *  monitor is clamped HERE rather than on the first resize event, so the width
 *  is never briefly wrong. */
export function panelWidthFromStored(raw: string | null, windowWidth: number): number {
  let stored: number = DEFAULT_PANEL_WIDTH
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { panelWidth?: unknown }
      stored = typeof parsed?.panelWidth === 'number' ? parsed.panelWidth : DEFAULT_PANEL_WIDTH
    } catch {
      // Corrupt JSON — hand-edited, or a half-written value.
      stored = DEFAULT_PANEL_WIDTH
    }
  }
  return clampPanelWidth(stored, windowWidth)
}

/** Read the persisted width synchronously, so the FIRST frame is already the
 *  right width instead of painting 360 and jumping (ADR-0026 §6). */
function loadPanelWidth(): number {
  try {
    return panelWidthFromStored(localStorage.getItem(LAYOUT_KEY), currentWindowWidth())
  } catch {
    // localStorage unavailable (tests).
    return clampPanelWidth(DEFAULT_PANEL_WIDTH, currentWindowWidth())
  }
}

function savePanelWidth(panelWidth: number): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ panelWidth }))
  } catch {
    // ignore: nothing to do if storage is unavailable
  }
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
  /** One store write for a restore (ADR-0016 §2: one undo step). The unit
   *  part rides along since 2026-09-04 — a receipt that did not carry it
   *  recomputed against whatever unit was current and reproduced the wrong
   *  count silently, in both directions. `undefined` leaves it untouched (a
   *  preset, which never carries one); `null` is the whole file. */
  restoreInputs: (
    settings: Partial<PackingSettings>,
    overrides: PartWeightOverrides,
    unitPartName?: string | null
  ) => void

  /** Which 3D view is showing (VISION: "toggle between model view and packed
   *  view"). 'auto' follows the estimate — the packed carton once one exists —
   *  while an explicit choice pins it, so inspecting the model does not get
   *  undone by the next re-pack. */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // --- layout slice (ADR-0026) ---
  /** The control panel's width in px, driven onto `--panel-width`. Layout, not
   *  an input: outside `settings`, so presets never carry it, and off the undo
   *  stack (ADR-0026 §7) — ADR-0016's snapshot covers settings and overrides,
   *  and this is in neither. */
  panelWidth: number
  /** Set the width, clamped by the caller (drag, keys, reset, resize all go
   *  through `clampPanelWidth` first — this setter stores what they agreed). */
  setPanelWidth: (width: number) => void

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
  restoreInputs: (patch, partWeightsG, unitPartName) =>
    set((s) => ({
      settings: { ...s.settings, ...patch },
      partWeightsG,
      unitPartName: unitPartName === undefined ? s.unitPartName : unitPartName
    })),

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
    set({ ...NO_PACK, packStatus: 'failed', packError }),

  panelWidth: loadPanelWidth(),
  setPanelWidth: (panelWidth) => set({ panelWidth })
}))

// Persist settings whenever they change (the object identity changes on updateSettings).
useAppStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) saveSettings(state.settings)
  if (state.panelWidth !== prev.panelWidth) savePanelWidth(state.panelWidth)
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
