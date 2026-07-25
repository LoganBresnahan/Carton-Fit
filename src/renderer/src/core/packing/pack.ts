import { boxVolume } from './types'
import type {
  FitCheckResult,
  MaxQuantityResult,
  OrientationProvider,
  PackBox,
  PackPart,
  PackRequest,
  PackResult,
  Placement,
  QualityTier
} from './types'
import { aabbOrientations } from './orientations'
import { thoroughOrientations } from './thoroughOrientations'
import { greedyShelfFit } from './shelfFit'
import { gridFillQuantity } from './quantityGrid'
import { composeUnit } from './unit'

// The packing orchestrator (ADR-0003 phase 5): the one entry point the pack
// worker calls. It routes a PackRequest to the right tier's OrientationProvider
// and the right mode's Strategy, then assembles a fully-populated PackResult —
// verdict, binding constraint, utilization, and the heuristic label the ADR
// mandates. Pure: no worker, no DOM, testable in isolation, and total (it never
// throws on degenerate input — a part bigger than the carton is a 0/none result,
// not an error).

function providerFor(tier: QualityTier): OrientationProvider {
  // 'nesting' is disabled in the UI (TIERS[].enabled === false); if a request
  // ever carries it, fall back to fast rather than throwing.
  return tier === 'thorough' ? thoroughOrientations : aabbOrientations
}

function boxOf(part: PackPart, provider: OrientationProvider): PackBox {
  return { name: part.name, weightG: part.weightG, orientations: provider(part) }
}

/** Volume a placement's bounding box occupies in the carton (mm³). */
function placementVolume(p: Placement): number {
  return (
    (p.boxMax[0] - p.boxMin[0]) * (p.boxMax[1] - p.boxMin[1]) * (p.boxMax[2] - p.boxMin[2])
  )
}

/** Fraction of the carton filled by placed bounding boxes, clamped to [0, 1].
 *  Bounding-box based, not mesh-based: PackPart carries no indices, and the box
 *  is what the packer actually consumes (air inside a part's box is unusable). */
function clampUtilization(occupied: number, cartonVolume: number): number {
  if (cartonVolume <= 0) return 0
  return Math.min(1, occupied / cartonVolume)
}

function fitCheck(request: PackRequest, provider: OrientationProvider): FitCheckResult {
  const boxes = request.parts.map((p) => boxOf(p, provider))
  const fit = greedyShelfFit(boxes, request.carton, request.clearances, request.maxWeightG)
  const occupied = fit.placements.reduce((sum, p) => sum + placementVolume(p), 0)
  return {
    mode: 'fit-check',
    tier: request.tier,
    fits: fit.unplaced.length === 0,
    unplaced: fit.unplaced,
    placements: fit.placements,
    binding: fit.binding,
    heuristic: true, // greedy shelf placement — see verdictCaption
    utilization: clampUtilization(occupied, boxVolume(request.carton))
  }
}

function maxQuantity(request: PackRequest, provider: OrientationProvider): MaxQuantityResult {
  if (request.parts.length === 0) {
    return {
      mode: 'max-quantity',
      tier: request.tier,
      count: 0,
      placements: [],
      binding: 'geometry',
      heuristic: true,
      utilization: 0
    }
  }
  const unit = boxOf(composeUnit(request.parts), provider)
  const q = gridFillQuantity(unit, request.carton, request.clearances, request.maxWeightG)
  // Utilization from count × one-cell volume, NOT placements.length: the grid is
  // uniform, and placements may be truncated at MAX_GRID_PLACEMENTS while count
  // reports the true total.
  const cellVolume = q.placements.length > 0 ? placementVolume(q.placements[0]) : 0
  return {
    mode: 'max-quantity',
    tier: request.tier,
    count: q.count,
    placements: q.placements,
    binding: q.binding,
    heuristic: true, // grid fill is a lower bound — see verdictCaption
    utilization: clampUtilization(q.count * cellVolume, boxVolume(request.carton))
  }
}

export function pack(request: PackRequest): PackResult {
  const provider = providerFor(request.tier)
  return request.mode === 'fit-check'
    ? fitCheck(request, provider)
    : maxQuantity(request, provider)
}

// heuristic-verdict-labeling (ADR-0003): the placement is heuristic and must be
// labeled as such — never sold as a proof of non-fit. The epistemic direction
// differs by outcome, and this caption carries it precisely:
//  - a POSITIVE result (parts fit / N copies placed) is a constructive proof —
//    we hold a concrete, overlap-free arrangement;
//  - a NEGATIVE or count result understates: a cleverer arrangement might place
//    the unplaced parts, or fit more copies. That is the claim the ADR forbids
//    presenting as certain.
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
  return `At least ${result.count} fit (${limit}). Heuristic — a mixed arrangement may fit more.`
}
