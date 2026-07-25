import type { PackRequest, PackResult } from '../core/packing/types'

// Re-exported so main-thread consumers (the pipeline) speak the pack contract
// through this transport module without importing core/packing themselves —
// keeping engine references (even type-only) at the worker boundary.
export type { PackRequest, PackResult } from '../core/packing/types'

// The renderer ⇄ pack-worker message contract (ADR-0003 phase 5). Modeled on
// import-protocol, with one deliberate divergence in transfer discipline.
//
// TRANSFER DIVERGENCE — pack COPIES, import TRANSFERRED. The import worker took
// ownership of the file bytes (the renderer had no further use for them), so the
// request buffer was transferred. A pack request carries each part's `positions`,
// but the RENDERER still needs those buffers — the viewport renders from them.
// Transferring would neuter the live meshes. So a PackJob is sent by structured
// clone (no transfer list): the worker gets a copy, the renderer keeps the
// originals. The copy is a few MB and sub-millisecond; correctness beats the
// saved copy. PackResponse is all plain data (numbers, small tuples), so nothing
// is transferred back either — the DataCloneError dedupe trap simply never
// applies to this protocol. (Kept in mind, not reinvented — plan risk 4.)

/** Correlates a response to its request; monotonic per session, like import. */
export interface PackJob {
  id: number
  request: PackRequest
}

/** Worker → renderer, success. */
export interface PackOk {
  id: number
  ok: true
  result: PackResult
}

/** Worker → renderer, failure (an unexpected throw inside the engine). */
export interface PackError {
  id: number
  ok: false
  error: string
}

export type PackResponse = PackOk | PackError
