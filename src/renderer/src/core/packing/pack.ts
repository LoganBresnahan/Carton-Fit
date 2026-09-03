import { EPS } from '../geometry'
import { boxVolume, sanitizeClearances } from './types'
import type {
  Clearances,
  FitCheckResult,
  FitPlacement,
  MaxQuantityResult,
  OrientationOption,
  OrientationProvider,
  PackBox,
  PackPart,
  PackRequest,
  PackResult,
  Placement,
  QualityTier,
  Vec3
} from './types'
import { aabbOrientations } from './orientations'
import { thoroughOrientations } from './thoroughOrientations'
import { greedyShelfFit } from './shelfFit'
import { extremePointFit } from './extremePointFit'
import type { EpFitPlacement } from './extremePointFit'
import { gridFillQuantity } from './quantityGrid'
import { quantityBounds } from './quantityBound'
import { refineQuantity } from './quantityRefine'
import type { QuantityRefinement } from './quantityRefine'
import { largestFreeSpace } from './ems'
import { validatePlacements } from './validate'
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
function occupiedVolume(fit: Pick<FitPlacement, 'placements'>): number {
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
 * more parts unplaced, so it loses on its own merits; `racedFit`'s crash barrier
 * is what discards it explicitly, and this comparison is the floor underneath
 * that either way.
 */
export function beatsIncumbent(challenger: FitPlacement, incumbent: FitPlacement): boolean {
  if (challenger.unplaced.length !== incumbent.unplaced.length) {
    return challenger.unplaced.length < incumbent.unplaced.length
  }
  return occupiedVolume(challenger) - occupiedVolume(incumbent) > EPS
}

/** A challenger fit engine, behind the crash barrier. Parameterized only so the
 *  barrier's three triggers can be tested with a challenger built to fire them —
 *  a throwing one, an overlapping one, a tripped one. Production always passes
 *  the default. */
export type FitChallenger = (
  boxes: readonly PackBox[],
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number
) => EpFitPlacement

/**
 * The crash barrier (ADR-0022 §2), the composition this phase exists to build:
 * shelf runs as incumbent, extreme-point challenges, and the challenger's answer
 * is admitted only if it survives three independent checks — it did not throw,
 * its arrangement passes the independent validator, and it completed its search.
 * On any of the three the incumbent's answer stands, which is exactly what the
 * app answered before ADR-0022.
 *
 * This is a defect detector, not a mode (§2): either trigger firing on a
 * realistic carton is a bug to fix, and the differential fuzz is what guards
 * against it. Nothing is surfaced to the user, because there is nothing for them
 * to do about it and the answer they get is still a real arrangement.
 *
 * Why the validator is asked about CLEARANCES too, not just physical
 * possibility: an arrangement that quietly eats the foam gap the user asked for
 * is a broken promise stated with the same confidence as a correct answer, and
 * shelf — which honors the gap by construction — is sitting right there as the
 * alternative. `isPhysicallyImpossible` exists for callers that must be lenient;
 * a barrier with a free, correct fallback is not one of them. The clearances are
 * sanitized first so the judge answers the question the engine was asked — an
 * unsanitized infinite gap would make the judge reject EVERY arrangement, on
 * every pack, silently.
 *
 * Why a BACKSTOP TRIP is discarded here even though a truncated arrangement is
 * valid and loses the race on its own merits: §2 names the trip as one of the
 * barrier's two triggers and says the incumbent's answer is then standing, and a
 * partial search is a result that depends on where the budget ran out. The cost
 * is real — a tripped EP that still beat shelf is thrown away — and accepted,
 * because a trip means a part count no realistic carton has (past ~250 parts,
 * see DEFAULT_MAX_EP_OPS). Quantity mode is the deliberate opposite; see
 * `refineWithBarrier`.
 */
export function racedFit(
  boxes: readonly PackBox[],
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number,
  challenger: FitChallenger = extremePointFit
): FitPlacement {
  // Shelf is overlap-free by construction and O(n); extreme-point recovers the
  // gaps shelf abandons but is the first placement code here that can be
  // geometrically wrong. Racing them means the app structurally cannot answer
  // worse than it did before the upgrade, which is the only regression a user
  // would notice — engines are invisible, and nothing ever promised
  // extreme-point quality by name.
  const shelf = greedyShelfFit(boxes, carton, clearances, maxWeightG)

  let ep: EpFitPlacement
  try {
    ep = challenger(boxes, carton, clearances, maxWeightG)
  } catch {
    return shelf
  }
  if (ep.backstopTripped) return shelf

  const violations = validatePlacements(ep.placements, carton, {
    clearances: sanitizeClearances(clearances),
    limit: 1
  })
  if (violations.length > 0) return shelf

  return beatsIncumbent(ep, shelf) ? ep : shelf
}

/** Volume of an orientation's extent, factors sorted (the ulp lesson, again):
 *  mathematically equal orientations must compare equal, or float noise rather
 *  than the documented tie-break picks which one gets reported. */
function optionVolume(option: OrientationOption): number {
  const e = [...option.extent].sort((a, b) => a - b)
  return e[0] * e[1] * e[2]
}

/** Extents descending — the shape §7 compares triples in, and a total order for
 *  breaking volume ties. */
function descending(extent: Vec3): Vec3 {
  const e = [...extent].sort((a, b) => b - a)
  return [e[0], e[1], e[2]]
}

/** Lexicographic compare of two descending triples; < 0 ⇒ `a` is the smaller. */
function compareDescending(a: Vec3, b: Vec3): number {
  for (let axis = 0; axis < 3; axis++) {
    if (a[axis] !== b[axis]) return a[axis] - b[axis]
  }
  return 0
}

/** An orientation with real, non-negative extents — the only kind worth naming
 *  in a sentence about what a part needs. */
function isMeasurable(option: OrientationOption): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(option.extent[axis]) || option.extent[axis] < 0) return false
  }
  return true
}

/**
 * The smallest part left over and what its smallest orientation needs (ADR-0022
 * §7's second clause). "Smallest" both times by sorted-factor volume, ties broken
 * by descending extents and then by request order, so the sentence is a
 * deterministic function of the arrangement like every other reported figure.
 *
 * The SMALLEST leftover is the informative one: if what is left over would not
 * go in even at its most accommodating, saying so about the biggest part
 * explains nothing the part list did not already. Parts with no measurable
 * orientation are skipped rather than reported as needing NaN.
 */
function smallestUnplaced(
  boxes: readonly PackBox[],
  unplaced: readonly string[]
): { name: string; extentMm: Vec3 } | undefined {
  const left = new Set(unplaced)
  let best: { name: string; extentMm: Vec3; volume: number; sorted: Vec3 } | undefined
  for (const box of boxes) {
    if (!left.has(box.name)) continue
    for (const option of box.orientations) {
      if (!isMeasurable(option)) continue
      const volume = optionVolume(option)
      const sorted = descending(option.extent)
      // Strictly-better replacement, so the first candidate wins every tie and
      // the winner does not depend on scan order beyond the documented one.
      if (
        best &&
        !(volume < best.volume || (volume === best.volume && compareDescending(sorted, best.sorted) < 0))
      ) {
        continue
      }
      best = { name: box.name, extentMm: option.extent, volume, sorted }
    }
  }
  return best && { name: best.name, extentMm: best.extentMm }
}

function fitCheck(request: PackRequest, provider: OrientationProvider): FitCheckResult {
  const boxes = request.parts.map((p) => boxOf(p, provider))
  const fit = racedFit(boxes, request.carton, request.clearances, request.maxWeightG)
  const occupied = occupiedVolume(fit)
  const result: FitCheckResult = {
    mode: 'fit-check',
    tier: request.tier,
    fits: fit.unplaced.length === 0,
    unplaced: fit.unplaced,
    placements: fit.placements,
    binding: fit.binding,
    heuristic: true, // the better of two heuristics is still one — see verdictCaption
    utilization: clampUtilization(occupied, boxVolume(request.carton))
  }
  if (!result.fits) {
    // The void is derived from the WINNER's placements, whichever engine made
    // them — it explains this arrangement's stopping point (ADR-0022 §3), so it
    // must describe the arrangement actually returned. Computed only on a
    // non-fit: that is the only place §7 speaks, and the fits path shouldn't
    // pay for a report it never shows.
    const space = largestFreeSpace(fit.placements, request.carton, request.clearances)
    if (space !== null) result.largestFreeSpace = space
    const smallest = smallestUnplaced(boxes, fit.unplaced)
    if (smallest !== undefined) result.smallestUnplaced = smallest
  }
  return result
}

/** The refinement step, behind the barrier. Parameterized for the same reason
 *  `FitChallenger` is. */
export type QuantityChallenger = (
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number,
  gridCount: number,
  upperBound?: number
) => QuantityRefinement | null

/**
 * The crash barrier over quantity-mode refinement (ADR-0022 §2 applied to §4).
 * The grid is the incumbent here, and `refineQuantity`'s ratchet already returns
 * null unless EP strictly beats it — so this adds the same two guarantees the fit
 * check gets: a throw is not a failed estimate, and an arrangement the validator
 * rejects is not an answer.
 *
 * ONE DELIBERATE ASYMMETRY with `racedFit`: a backstop trip is NOT a discard
 * here. In fit check a trip means a part count no realistic carton has, so §2's
 * "the incumbent's answer is still standing" is the right response. In quantity
 * mode §4 makes the same backstop the BOUND ON REFINEMENT COST — tripping is the
 * expected way a refinement of tens of thousands of copies ends, not a symptom —
 * and the count it reports is a real achieved arrangement either way. Discarding
 * on a trip there would delete the feature §4 asks for. (`refineQuantity` does
 * not surface the trip at all, which is why there is nothing to check.)
 */
export function refineWithBarrier(
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number,
  gridCount: number,
  upperBound: number | undefined,
  challenger: QuantityChallenger = refineQuantity
): QuantityRefinement | null {
  let refined: QuantityRefinement | null
  try {
    refined = challenger(unit, carton, clearances, maxWeightG, gridCount, upperBound)
  } catch {
    return null
  }
  if (refined === null) return null

  const violations = validatePlacements(refined.placements, carton, {
    clearances: sanitizeClearances(clearances),
    limit: 1
  })
  return violations.length > 0 ? null : refined
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
  const bounds = quantityBounds(unit, request.carton, request.clearances, request.maxWeightG)
  // The grid stands as the floor; EP refines with mixed orientations inside the
  // operation backstop (ADR-0022 §4), behind the crash barrier. refineQuantity
  // returns non-null only on a STRICT improvement, so this is max(grid, EP) by
  // construction — the worst case is exactly the instant grid answer, and
  // retreating from refinement is deleting this call.
  const refined = refineWithBarrier(
    unit,
    request.carton,
    request.clearances,
    request.maxWeightG,
    q.count,
    Number.isFinite(bounds.overall) ? bounds.overall : undefined
  )
  // Grid utilization from count × one-cell volume, NOT placements.length: the
  // grid is uniform, and placements may be truncated at MAX_GRID_PLACEMENTS
  // while count reports the true total. A refined arrangement is the opposite
  // case — heterogeneous orientations whose volumes differ under the thorough
  // tier's OBB options, never truncated (the ops budget trips far below any
  // materialization ceiling) — so its utilization is summed from what was
  // actually placed.
  const occupied = refined
    ? occupiedVolume(refined)
    : q.count * (q.placements.length > 0 ? placementVolume(q.placements[0]) : 0)
  const winner = refined ?? q
  const result: MaxQuantityResult = {
    mode: 'max-quantity',
    tier: request.tier,
    count: winner.count,
    placements: winner.placements,
    binding: winner.binding,
    heuristic: true, // grid fill and EP refinement are both lower bounds — see verdictCaption
    utilization: clampUtilization(occupied, boxVolume(request.carton))
  }
  if (Number.isFinite(bounds.overall)) {
    // The max is float insurance, not arithmetic: both sides use the same
    // tolerant floors, but "47 fit (upper bound 44)" is a visible contradiction
    // and the achieved count is itself a proof of achievability, so the bound
    // may only ever be raised to meet it, never trusted to sit below it.
    result.upperBound = Math.max(bounds.overall, winner.count)
  }
  // Same insurance, same reason — and the geometry-only bound needs it more,
  // because the wording layer reads EQUALITY with the count as proof that the
  // carton is full (ADR-0029 phase-2 amendment 2). A bound sitting one below
  // the count is already broken; raising it keeps it a valid bound rather than
  // letting a float dip masquerade as a tighter proof.
  if (Number.isFinite(bounds.geometry)) {
    result.geometryBound = Math.max(bounds.geometry, winner.count)
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
