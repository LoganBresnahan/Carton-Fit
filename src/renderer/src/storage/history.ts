import { useAppStore } from '../store'
import { storageMessage } from './message'
import type { StorageApi } from '../../../shared/storage'

// Estimate history recording (ADR-0007; VISION "every estimate is recorded").
//
// Mirrors packing/service.ts: a store subscription, installed once from the
// renderer entry, so no component ever records anything. Recording is a
// consequence of an estimate completing, not of a button being pressed —
// consistent with ADR-0009's no-compute-button model.
//
// EXACTLY-ONCE is the whole difficulty here. Three things could each cause a
// duplicate, and the guard has to survive all of them:
//
//   1. React StrictMode double-invokes effects, so `start` must be idempotent.
//   2. A Zustand subscriber fires on EVERY state write — including the pack
//      slice's own writes and unrelated slices like viewMode — so "status is
//      done" is not a trigger, it is a state. The trigger is the *transition*.
//   3. A re-pack producing an identical result still produces a NEW result
//      object, which is a genuinely new estimate; but the same result object
//      seen twice never is.
//
// So the guard keys on the identity of the `packResult` object: `packSucceeded`
// creates a fresh one per completed pack, and nothing else in the store mints
// them. Comparing values instead would silently drop the legitimate case of the
// same part re-estimated with the same settings.

let started = false

/** The console gets one line per session; the UI gets told every time. */
let warned = false

/**
 * Report a failed recording.
 *
 * Storage is optional by design (it opens lazily and may be unavailable — see
 * main/storage.ts), so this must never surface as a broken estimate: the
 * estimate itself is correct and stays on screen. But it must not be invisible
 * either. VISION promises "every estimate is recorded", and until now the only
 * trace of that promise breaking was a console line no user reads — the app
 * looked exactly the same whether history worked or not.
 *
 * Set on EVERY failure rather than once, because `setConfigurations` clears
 * `storageError` on any successful list; reporting once would let an unrelated
 * success erase a condition that is still true. The console line stays
 * once-only, since that is a developer signal and would otherwise repeat with
 * every debounced re-pack.
 */
function report(error: unknown): void {
  const reason = storageMessage(error)
  if (!warned) {
    warned = true
    console.warn('[history] estimate not recorded:', reason)
  }
  useAppStore.getState().setStorageError(`Estimate history is not being recorded: ${reason}`)
}

/**
 * Record every completed estimate to history.
 *
 * @param api injection seam for tests — defaults to the preload bridge.
 * @returns an unsubscribe function.
 */
export function startEstimateRecording(api?: StorageApi): () => void {
  if (started) return () => {}
  started = true

  const storage = api ?? window.api.storage
  let lastRecorded: unknown = null

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    // The transition, not the state: only act when a NEW result object appears.
    if (state.packResult === prev.packResult) return
    if (state.packStatus !== 'done' || state.packResult === null) return
    if (state.packResult === lastRecorded) return

    lastRecorded = state.packResult

    void storage
      .recordEstimate({
        fileName: state.file?.name ?? 'unknown',
        // Null when hashing failed; history still records, it just cannot be
        // threaded to other imports of the same geometry.
        contentHash: state.contentHash ?? '',
        settings: state.settings,
        result: state.packResult
      })
      .catch(report)
  })

  return () => {
    unsubscribe()
    started = false
    lastRecorded = null
  }
}
