import { buildPackRequest } from './request'
import type { PackingSettings } from '../store'
import type { PackRequest } from '../core/packing/types'
import type { ImportedPart } from '../workers/import-protocol'

// Auto-run (roadmap item 4): the estimate follows the inputs — no "compute"
// button. Every settings edit and every new import re-packs.
//
// Debounced because a number field emits a change per KEYSTROKE: typing "12"
// into a carton dimension produces "1" then "12", and dispatching the
// intermediate is wasted worker time whose result the next dispatch supersedes
// anyway (the pipeline's id guard drops it). Coalescing to the last value in a
// short window is both cheaper and what the user means. The timer is injected so
// vitest drives the coalescing deterministically, with no fake clock.

export const DEFAULT_PACK_DEBOUNCE_MS = 180

/** Schedule/cancel as ONE injected object so the two can never come from
 *  different clocks. The handle is opaque — only the timer that issued it
 *  interprets it. */
export interface AutoPackTimer {
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

const REAL_TIMER: AutoPackTimer = {
  schedule: (fn, ms) => setTimeout(fn, ms),
  // Safe: this cancel only ever receives handles this same object scheduled.
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export interface AutoPackOptions {
  delayMs?: number
  timer?: AutoPackTimer
}

export interface AutoPack {
  /** Call when parts or settings change; coalesces into one dispatch. */
  changed(parts: readonly ImportedPart[], settings: PackingSettings): void
  dispose(): void
}

export function createAutoPack(
  dispatch: (request: PackRequest) => void,
  options: AutoPackOptions = {}
): AutoPack {
  const delayMs = options.delayMs ?? DEFAULT_PACK_DEBOUNCE_MS
  const timer = options.timer ?? REAL_TIMER

  let pending: unknown = null

  return {
    changed(parts, settings) {
      if (pending !== null) timer.cancel(pending)
      // The request is built when the timer FIRES, from the arguments of the
      // last call — so the dispatched request always reflects the newest inputs,
      // and superseded intermediates cost nothing (not even a mesh-volume pass).
      pending = timer.schedule(() => {
        pending = null
        const request = buildPackRequest(parts, settings)
        if (request) dispatch(request)
      }, delayMs)
    },
    dispose() {
      if (pending !== null) timer.cancel(pending)
      pending = null
    }
  }
}
