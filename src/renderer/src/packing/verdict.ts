import type { BindingConstraint, MaxQuantityResult, PackResult } from '../core/packing/types'

// Result presentation (roadmap item 4). Lives on the RENDERER side, not in
// core/packing, because it is presentation rather than engine math — and
// because a component importing core/packing/pack.ts would pull the whole
// engine graph (hull search, strategies) into the main-thread bundle, defeating
// the worker boundary. This module imports types only.

/**
 * The heuristic labeling ADR-0003 mandates. The epistemic direction differs by
 * outcome, and the wording carries it precisely:
 *  - a POSITIVE result (parts fit / N copies placed) is a constructive proof —
 *    we hold a concrete, overlap-free arrangement;
 *  - a NEGATIVE or count result understates: a cleverer arrangement might place
 *    the unplaced parts, or fit more copies. That is the claim the ADR forbids
 *    presenting as certain.
 */
export function verdictCaption(result: PackResult): string {
  if (result.mode === 'fit-check') {
    const total = result.placements.length + result.unplaced.length
    if (result.fits) {
      return total === 0
        ? 'Nothing to pack.'
        : `All ${total} part${total === 1 ? '' : 's'} fit — a concrete arrangement was found.`
    }
    return (
      `${result.placements.length} of ${total} parts placed; ${result.unplaced.length} ` +
      `did not fit. Heuristic placement — not a proof the rest cannot fit.`
    )
  }
  if (result.count === 0) return 'None fit in this carton.'
  const limit = result.binding === 'weight' ? 'weight-limited' : 'space-limited'
  return (
    `At least ${result.count.toLocaleString()} fit (${limit}). ` +
    `Heuristic — a mixed arrangement may fit more.`
  )
}

/** Short headline: the answer itself, before any qualification. */
export function verdictHeadline(result: PackResult): string {
  if (result.mode === 'fit-check') return result.fits ? 'Fits' : "Doesn't fit"
  return result.count.toLocaleString()
}

/** Which hard constraint bound the result — ADR-0004 requires stating it. */
export function bindingLabel(binding: BindingConstraint): string {
  return binding === 'weight' ? 'weight' : 'space'
}

/** Carton fill as a percentage. Bounding-box based: air trapped inside a part's
 *  box is not usable by another part, so the box is what packing consumes. */
export function utilizationPercent(utilization: number): string {
  const pct = utilization * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

/**
 * True when the reported count exceeds the placements actually materialized.
 * The engine caps materialization (MAX_GRID_PLACEMENTS) because a weightless
 * 1 mm part in a 600 mm carton counts 2e8 copies; `count` stays true, so the
 * panel must say the LAYOUT is partial rather than let the 3D view imply the
 * count is wrong.
 */
export function truncatedLayout(result: PackResult): result is MaxQuantityResult {
  return result.mode === 'max-quantity' && result.count > result.placements.length
}
