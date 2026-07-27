import { extremePointFit } from './extremePointFit'
import type { EpOptions } from './extremePointFit'
import { degenerateExtentBar, weightCapacity } from './quantityGrid'
import type { BindingConstraint, Clearances, PackBox, Placement, Vec3 } from './types'

// quantity-mode-ep-refinement (ADR-0022 §4): the grid answers instantly and
// stands as the floor; extreme-point placement then tries to beat it with mixed
// orientations and leftover-space placement, inside the same deterministic
// operation backstop the fit check uses — in quantity mode the backstop does
// double duty as the bound on refinement cost, which is why its constant was
// sized on responsiveness (see DEFAULT_MAX_EP_OPS).
//
// THE RATCHET IS THE CONTRACT: this function returns a refinement only when EP
// STRICTLY beats the grid's count, and null in every other case — so the
// orchestrator's answer is max(grid, EP) by construction, the worst case is
// exactly today's instant grid answer, and the ADR's retreat trigger ("drop
// quantity mode back out") stays a one-line change: stop calling this.
//
// A dead heat keeps the grid, deliberately (beatsIncumbent's philosophy): the
// same count as a regular lattice is not an improvement worth trading the
// lattice for, and count is the answer in this mode — there is no volume
// tie-break, because every copy is the same unit.
//
// Null is also how this function refuses inputs refinement cannot help or must
// not touch:
//   - grid count 0: the grid's zero is either weight (arrangement-independent),
//     a unit no orientation fits (EP shares the window, so it places zero too),
//     or the degenerate-extent guard — which EP must not undo (see below).
//   - bound already met: `upperBound` is RIGOROUS (quantityBound), so
//     grid == bound proves the lattice optimal and the search is free.
//   - nothing left after the degenerate filter: EP placing float-noise sheets
//     the grid refused to count would be "refinement" manufacturing copies out
//     of quantization error — the OOM finding that built the bar, resurfaced.

/** Ceiling on copies materialized for the EP attempt. This is MEMORY insurance,
 *  not the search budget — the ops backstop is what actually limits the search,
 *  and by its phase-3 measurement (ops grow with the cube of the count; 250
 *  parts ≈ 1.8e8 of the 2e8 budget) a run cannot place anywhere near this many
 *  copies before tripping. What the cap really bounds is the PackBox array fed
 *  in when the upper bound is huge or absent (a tiny part in a big carton has a
 *  six-figure bound; the grid already counted those, and refinement has nothing
 *  to add at that scale — the skip below fires first). */
export const MAX_REFINE_COPIES = 512

export interface QuantityRefinement {
  /** Copies EP placed — strictly more than the grid's count. */
  count: number
  placements: Placement[]
  binding: BindingConstraint
}

/**
 * Try to beat the grid's count with extreme-point placement. Returns null when
 * the grid stands (see the module doc for every reason); otherwise a strictly
 * better count with its placements and binding attribution.
 *
 * `gridCount` is the incumbent's answer; `upperBound` is the finite rigorous
 * bound when one exists (quantityBound), which both sizes the attempt and
 * proves it unnecessary when the grid already met it.
 */
export function refineQuantity(
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number,
  gridCount: number,
  upperBound?: number,
  options?: EpOptions
): QuantityRefinement | null {
  if (!Number.isFinite(gridCount) || gridCount <= 0) return null

  // The grid's own bar, per orientation: an option with a noise-thin extent is
  // not a way to place the part, whatever the overlap check thinks of it.
  const placeable = unit.orientations.filter((o) => {
    const bar = degenerateExtentBar(o.extent)
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(o.extent[axis]) || o.extent[axis] <= bar) return false
    }
    return true
  })
  if (placeable.length === 0) return null

  // Copies to attempt: enough that beating the grid is possible, no more than
  // the rigorous bound says could ever be placed. When that leaves nothing
  // above the incumbent, the search is pointless (cap) or provably so (bound).
  const ceiling =
    typeof upperBound === 'number' && Number.isFinite(upperBound) ? upperBound : Infinity
  const copies = Math.min(ceiling, MAX_REFINE_COPIES)
  if (copies <= gridCount) return null

  const box: PackBox = { name: unit.name, weightG: unit.weightG, orientations: placeable }
  const boxes: PackBox[] = new Array(copies).fill(box)
  const ep = extremePointFit(boxes, carton, clearances, maxWeightG, options)

  const count = ep.placements.length
  if (count <= gridCount) return null

  // Binding attribution has two honest sources, and which one speaks depends
  // on whether EP left copies unplaced (adversarial-verify refutation closed
  // here: the first build recomputed binding from weightCapacity alone, whose
  // RELATIVE floorTolerant disagrees with EP's ABSOLUTE-EPS cap test by one
  // whenever total weight tops 1 kg and the cap sits micrograms under an
  // integer multiple — shipping 'geometry' for a count that EP itself had
  // weight-rejected its way to).
  // - Copies went unplaced: the engine that rejected them knows why. Its
  //   binding is rejection-derived (weight wins over geometry when both
  //   occurred; a backstop trip joins geometry) — take it verbatim.
  // - Every fed copy placed: nothing was rejected, so the label falls to the
  //   grid convention on the arrangement-independent weight cap — at or below
  //   the achieved count, weight is what stops a better answer ('weight' on
  //   the exact tie, the user-facing limit); above it, geometry stopped the
  //   bound first.
  const weightCount = weightCapacity(unit.weightG, maxWeightG)
  const binding: BindingConstraint =
    ep.unplaced.length > 0 ? ep.binding : weightCount <= count ? 'weight' : 'geometry'

  return { count, placements: ep.placements, binding }
}
