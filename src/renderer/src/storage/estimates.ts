import { useAppStore, type PackingSettings } from '../store'
import { pruneOverrides, type PartWeightOverrides } from '../packing/kinds'
import { storageMessage } from './message'
import type { EstimateRow, StorageApi } from '../../../shared/storage'

// Saved estimates (ADR-0016). Replaces the auto-recording subscription this
// module used to hold.
//
// WHY EXPLICIT. VISION originally said "every estimate is recorded", written
// when estimating meant pressing a compute button. ADR-0009 removed the button,
// which quietly turned that rule into "every keystroke that survived a 180 ms
// debounce" — dozens of intermediate cartons per session, with nothing in the
// data marking which one the user actually meant. Deduplicating them was the
// obvious fix and the wrong one: it removes repetition, not noise. Only the
// user knows which estimate was an answer, so only the user can say.
//
// The row shape, the IPC and the schema are unchanged from the auto-recording
// era (no migration); what changed is when a row is written.

function api(injected?: StorageApi): StorageApi {
  return injected ?? window.api.storage
}

function fail(error: unknown): void {
  useAppStore.getState().setStorageError(storageMessage(error))
}

/**
 * Save the estimate currently on screen.
 *
 * Deliberately reads the store rather than taking the estimate as an argument:
 * the thing being saved is *what the user is looking at*, and passing it in
 * from a component would open a gap between the two.
 *
 * @returns true when a row was written.
 */
export async function saveEstimate(injected?: StorageApi): Promise<boolean> {
  const state = useAppStore.getState()

  // Not an error worth a banner — the button is disabled in this state, so
  // reaching here means a race with a re-pack, and the honest answer is "not
  // yet" rather than a scary message.
  if (state.packStatus !== 'done' || state.packResult === null) return false

  try {
    await api(injected).recordEstimate({
      fileName: state.file?.name ?? 'unknown',
      // Empty when hashing failed; the row still saves, it just cannot be
      // threaded to other imports of the same geometry.
      contentHash: state.contentHash ?? '',
      // Overrides ride ALONGSIDE settings rather than inside them (ADR-0018
      // §3): they are file-scoped, so folding them into PackingSettings would
      // put them in presets and localStorage, which is exactly what that
      // decision forbids. The blob is opaque JSON to storage, so carrying one
      // more key needs no schema change and no migration.
      settings: { ...state.settings, partWeightsG: state.partWeightsG },
      result: state.packResult
    })
    await refreshSavedEstimates(injected)
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

/** Load the saved-estimate list into the store. Safe to call on mount and after writes. */
export async function refreshSavedEstimates(injected?: StorageApi): Promise<void> {
  try {
    useAppStore.getState().setSavedEstimates(await api(injected).recentEstimates())
  } catch (error) {
    fail(error)
  }
}

/**
 * Apply a saved estimate's SETTINGS to the live inputs.
 *
 * Never its result (ADR-0016 §3). The estimate on screen is always one the
 * engine just computed from the current inputs — auto-run, the staleness
 * dimming and the verdict wording all depend on that — so a saved row is a
 * receipt, not a cache. With the same file loaded, restoring the settings
 * re-runs the pack and reproduces the answer honestly; with a different file
 * loaded, the user gets that file's answer under those settings, produced and
 * labelled by the normal flow.
 *
 * Merged over current settings for the same reason presets are (ADR-0007): a
 * row written by an older build may not mention fields this build has, and
 * replacing wholesale would leave them undefined.
 */
export function restoreEstimateSettings(row: EstimateRow): void {
  const state = useAppStore.getState()
  const saved = (row.settings ?? {}) as Partial<PackingSettings> & {
    partWeightsG?: unknown
  }

  // Per-kind overrides are restored separately from settings, and PRUNED to
  // the kinds the loaded file actually has (ADR-0018 §4). A row saved against
  // another assembly would otherwise leave invisible state: overrides with no
  // row in the panel, silently repricing nothing — or worse, a kind name that
  // happens to collide.
  // ONE store write, not two: two would be two undo entries, and ADR-0016 §2
  // makes a restore one step.
  const { partWeightsG, ...settings } = saved
  state.restoreInputs(
    settings,
    isOverrides(partWeightsG) ? pruneOverrides(partWeightsG, state.parts) : {}
  )
}

/** A row's blob is JSON written by whatever build was running at the time, so
 *  its shape is a claim, not a guarantee — the same defensiveness
 *  `packing/summary.ts` applies to the rest of the row. Individual values are
 *  re-checked at use (`overrideForPart`); this only rejects a wrong container. */
function isOverrides(value: unknown): value is PartWeightOverrides {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
