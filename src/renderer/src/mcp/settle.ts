import type { PackStatus } from '../packing/types'

// The SETTLE PROTOCOL (ADR-0029 v2, slice `v2-drive-tools`) — the subtle half
// of driving an auto-run app over MCP, and the reason this slice earns an
// adversarial verify pass.
//
// THE RACE: auto-run (ADR-0009) means "set inputs" is "run an estimate", but
// the run is debounced (180 ms) and computed in a worker. Between a drive
// call's store write and that pipeline finishing, the store still holds the
// PREVIOUS result with `packStatus: 'done'` — a status read alone would hand
// an AI client a plausible, confidently-worded answer to the QUESTION BEFORE
// LAST. Worse, a pack already in flight when the write lands will complete and
// set 'done' again, for the old inputs, before the new dispatch even starts.
//
// THE FIX is event-ordering, not waiting-long-enough: track a dirty flag that
// is raised by any input write and lowered only when a pack BEGINS — because
// `autoPack` builds its request when the debounce timer fires, from the newest
// inputs, a dispatch that begins after a write necessarily includes that
// write. Settled = not dirty AND the status is a terminal one. A stale result
// landing while dirty keeps us waiting; nothing time-based is trusted.
// (`e2e/harness.ts`'s waitForEstimate solves this from OUTSIDE the app, where
// only timing is observable; in here the ordering is.)

/** The store slice the tracker watches — structural, so tests can drive it
 *  with the real store or a hand-rolled one. */
export interface SettleState {
  parts: readonly unknown[]
  settings: unknown
  unitPartName: string | null
  partWeightsG: unknown
  packStatus: PackStatus
  packError: string | null
}

export interface SettleStore {
  getState(): SettleState
  subscribe(listener: (state: SettleState, prev: SettleState) => void): () => void
}

export type SettleOutcome =
  | { status: 'done' }
  | { status: 'failed'; error: string }
  /** Nothing to settle: no parts are loaded, so auto-run will never dispatch. */
  | { status: 'empty' }

export interface SettleTracker {
  /** True when an input write has not yet been consumed by a dispatch. */
  isDirty(): boolean
  waitForSettle(timeoutMs?: number): Promise<SettleOutcome>
}

/** Generous by design: a thorough-tier pack of a dense scene is seconds, and a
 *  premature timeout here IS the race this module exists to prevent. */
export const DEFAULT_SETTLE_TIMEOUT_MS = 120_000

export function createSettleTracker(store: SettleStore): SettleTracker {
  let dirty = false

  store.subscribe((state, prev) => {
    // The same input predicate as the auto-pack subscription — these four are
    // what define an estimate, so these four are what make one stale.
    if (
      state.parts !== prev.parts ||
      state.settings !== prev.settings ||
      state.unitPartName !== prev.unitPartName ||
      state.partWeightsG !== prev.partWeightsG
    ) {
      dirty = true
    }
    // Lowered on BEGIN, not on done: a completion can belong to old inputs, but
    // a dispatch cannot — autoPack coalesces to one pending timer and builds
    // the request from the newest arguments when it fires.
    if (state.packStatus === 'packing' && prev.packStatus !== 'packing') {
      dirty = false
    }
  })

  function settled(): SettleOutcome | null {
    const state = store.getState()
    if (state.parts.length === 0) return { status: 'empty' }
    if (dirty) return null
    if (state.packStatus === 'done') return { status: 'done' }
    if (state.packStatus === 'failed') {
      return { status: 'failed', error: state.packError ?? 'packing failed' }
    }
    return null // idle or packing — a dispatch is pending or running
  }

  return {
    isDirty: () => dirty,
    waitForSettle(timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS): Promise<SettleOutcome> {
      const immediate = settled()
      if (immediate !== null) return Promise.resolve(immediate)

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe()
          reject(
            new Error('the estimate did not settle in time — the app may be packing a very large scene')
          )
        }, timeoutMs)
        const unsubscribe = store.subscribe(() => {
          const outcome = settled()
          if (outcome !== null) {
            clearTimeout(timer)
            unsubscribe()
            resolve(outcome)
          }
        })
      })
    }
  }
}
