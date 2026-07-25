import type {
  BindingConstraint,
  MaxQuantityResult,
  PackRequest,
  PackResult
} from '../core/packing/types'

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
 * Total packed weight in grams — what the user's max-weight cap is actually
 * being spent on (ADR-0004 makes weight a hard constraint, so a cap with no
 * running total is a limit you cannot steer by).
 *
 * Derived from the request's per-part weights rather than carried on the result:
 * in max-quantity the count can exceed the materialized placements
 * (MAX_GRID_PLACEMENTS), so summing placements would under-report the very
 * number the cap is judged against.
 */
export function packedWeightG(result: PackResult, request: PackRequest): number {
  if (result.mode === 'max-quantity') {
    const unitWeight = request.parts.reduce((sum, part) => sum + part.weightG, 0)
    return result.count * unitWeight
  }
  const weightByName = new Map<string, number>()
  for (const part of request.parts) weightByName.set(part.name, part.weightG)
  return result.placements.reduce(
    (sum, placement) => sum + (weightByName.get(placement.partName) ?? 0),
    0
  )
}

/**
 * The warning for parts whose density-derived weight rests on a meaningless
 * volume (see `packing/request.ts` `openMeshParts`), or null when there are none.
 *
 * Worded to say what to DO, because the user can fix this in one click by
 * entering the weight directly — and because "not watertight" alone reads as a
 * modelling nitpick rather than "the number above is wrong".
 */
export function openMeshWarning(openParts: readonly string[]): string | null {
  if (openParts.length === 0) return null
  const shown = openParts.slice(0, 3).map((name) => `“${name}”`)
  const rest = openParts.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
  const subject =
    openParts.length === 1 ? `${list} is not a closed mesh` : `${list} are not closed meshes`
  return (
    `${subject}, so the volume behind this weight is unreliable — and weight is a ` +
    `hard limit here. Enter the part weight directly for a trustworthy count.`
  )
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
