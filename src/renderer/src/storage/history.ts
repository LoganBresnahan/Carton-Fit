import { useAppStore } from '../store'
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

/** Recording never blocks or breaks the app, so failures are logged once. */
let warned = false

function warnOnce(error: unknown): void {
  if (warned) return
  warned = true
  // Storage is optional by design (it opens lazily and may be unavailable —
  // see main/storage.ts), so a failure here must not surface as a broken
  // estimate. It is logged, once, rather than thrown or silently swallowed.
  console.warn('[history] estimate not recorded:', (error as Error)?.message ?? error)
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
      .catch(warnOnce)
  })

  return () => {
    unsubscribe()
    started = false
    lastRecorded = null
  }
}
