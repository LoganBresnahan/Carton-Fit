import { EPS } from '../geometry'
import { boxVolume } from './types'
import type {
  FitCheckResult,
  FitPlacement,
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
import { extremePointFit } from './extremePointFit'
import { gridFillQuantity } from './quantityGrid'
import { quantityUpperBound } from './quantityBound'
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

/** Volume of everything an arrangement placed (mm³). */
function occupiedVolume(fit: FitPlacement): number {
  return fit.placements.reduce((sum, p) => sum + placementVolume(p), 0)
}

/**
 * The incumbent race (ADR-0022 §2): does the challenger's arrangement beat the
 * incumbent's? Exported because the differential fuzz tests this rule directly —
 * it is the one place where a better engine could still produce a worse answer.
 *
 * Fewer unplaced parts wins, because that is the question fit check asks. On a
 * tie, more volume placed wins: the same number of parts placed is not the same
 * answer when one arrangement got the big ones in. Both are compared with the
 * incumbent holding the default — a challenger that cannot DEMONSTRATE an
 * improvement does not get to change the answer, which is what makes the race a
 * one-way ratchet rather than a coin toss.
 *
 * The volume margin is EPS rather than `>`: the two sums add the same parts'
 * volumes in different orders, so a set of placements that is genuinely equal can
 * differ in the last ulp, and without the margin that noise — not the rule — would
 * pick the winner.
 *
 * A backstop trip is deliberately NOT consulted here. A truncated EP result has
 * more parts unplaced, so it loses on its own merits; the crash barrier that
 * discards it explicitly is a later slice, and this comparison would be its floor
 * either way.
 */
export function beatsIncumbent(challenger: FitPlacement, incumbent: FitPlacement): boolean {
  if (challenger.unplaced.length !== incumbent.unplaced.length) {
    return challenger.unplaced.length < incumbent.unplaced.length
  }
  return occupiedVolume(challenger) - occupiedVolume(incumbent) > EPS
}

function fitCheck(request: PackRequest, provider: OrientationProvider): FitCheckResult {
  const boxes = request.parts.map((p) => boxOf(p, provider))
  // Run both, return the better (ADR-0022 §2). Shelf is overlap-free by
  // construction and O(n); extreme-point recovers the gaps shelf abandons but is
  // the first placement code here that can be geometrically wrong. Racing them
  // means the app structurally cannot answer worse than it did before the upgrade,
  // which is the only regression a user would notice — engines are invisible, and
  // nothing ever promised extreme-point quality by name.
  const shelf = greedyShelfFit(boxes, request.carton, request.clearances, request.maxWeightG)
  const ep = extremePointFit(boxes, request.carton, request.clearances, request.maxWeightG)
  const fit = beatsIncumbent(ep, shelf) ? ep : shelf
  const occupied = occupiedVolume(fit)
  return {
    mode: 'fit-check',
    tier: request.tier,
    fits: fit.unplaced.length === 0,
    unplaced: fit.unplaced,
    placements: fit.placements,
    binding: fit.binding,
    heuristic: true, // the better of two heuristics is still one — see verdictCaption
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
  const bound = quantityUpperBound(unit, request.carton, request.clearances, request.maxWeightG)
  // Utilization from count × one-cell volume, NOT placements.length: the grid is
  // uniform, and placements may be truncated at MAX_GRID_PLACEMENTS while count
  // reports the true total.
  const cellVolume = q.placements.length > 0 ? placementVolume(q.placements[0]) : 0
  const result: MaxQuantityResult = {
    mode: 'max-quantity',
    tier: request.tier,
    count: q.count,
    placements: q.placements,
    binding: q.binding,
    heuristic: true, // grid fill is a lower bound — see verdictCaption
    utilization: clampUtilization(q.count * cellVolume, boxVolume(request.carton))
  }
  if (Number.isFinite(bound)) {
    // The max is float insurance, not arithmetic: both sides use the same
    // tolerant floors, but "47 fit (upper bound 44)" is a visible contradiction
    // and the achieved count is itself a proof of achievability, so the bound
    // may only ever be raised to meet it, never trusted to sit below it.
    result.upperBound = Math.max(bound, q.count)
  }
  return result
}

export function pack(request: PackRequest): PackResult {
  const provider = providerFor(request.tier)
  return request.mode === 'fit-check'
    ? fitCheck(request, provider)
    : maxQuantity(request, provider)
}

// heuristic-verdict-labeling (ADR-0003) has two halves. The CONTRACT half is
// here: every result carries `heuristic: true`, so no consumer can present a
// greedy placement as a proof. The WORDING half — the captions that spell the
// claim out for the user — lives in `packing/verdict.ts` on the renderer side,
// so components can import it without pulling the engine graph across the
// worker boundary.
