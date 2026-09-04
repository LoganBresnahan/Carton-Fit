import { EPS } from '../geometry'
import { floorTolerant } from './quantityGrid'
import type { Clearances, PackBox, Vec3 } from './types'

// quantity-upper-bound (ADR-0022 §7): a RIGOROUS cap on how many copies of one
// unit any arrangement could place — the number the results line may state
// flatly ("47 fit (upper bound 54)"), so unlike every placement engine in this
// directory it is not a heuristic. The proof obligations are the whole file;
// both candidate formulas have known traps the build plan names, and each is
// closed by construction here.
//
// Model: a valid arrangement is what the VALIDATOR ACCEPTS, not what ideal
// geometry allows — the distinction is load-bearing, and getting it wrong was
// this slice's adversarial-verify refutation. The judge (and the EP engine,
// which shares its tolerance) forgives EPS = 1e-6 mm per face and per pair: a
// box may sit EPS outside the window [wall, carton − wall], and a pair may sit
// EPS closer than the between-parts gap g (separation = largest per-axis face
// distance). An ideal-geometry bound is NOT rigorous against that: one carton
// dimension within EPS of an exact fit admits a validator-clean arrangement
// with a whole extra row the ideal bound calls impossible — and phase 4's EP
// refinement can genuinely place it, shipping "5 fit (upper bound 4)". So
// every comparison below grants the arrangement what the judge grants it:
// windows widened by EPS per face, gaps narrowed by EPS per pair. The bound
// must dominate EVERY such arrangement — including mixed orientations, which
// is exactly what the grid incumbent cannot do and EP refinement can.
//
// THE HALO ARGUMENT both components stand on: inflate every placed box by g/2
// on each face (extent + g per axis). Two boxes separated by ≥ g on some axis
// have disjoint inflated interiors, and every inflated box fits in the window
// inflated the same way (extent usable + g per axis, since n·e + (n−1)·g ≤
// usable is n·(e+g) ≤ usable + g). So:
//
// In the tolerant metric the window has length usable + 2·EPS per axis and the
// effective pairwise gap is g − EPS, so the halo terms become: window
// usable + g + EPS per axis (+ another EPS below for the corner-at-edge case),
// cell/volume factors e + g − EPS per axis.
//
// 1. VOLUMETRIC: n · min-over-options Π max(0, eᵢ+g−EPS) ≤ Π(usableᵢ+g+2·EPS).
//    The min over options matters because thorough-tier options (OBB vs AABB
//    candidates) have genuinely different volumes; every copy consumes at
//    least the smallest inflated volume, whichever orientation it uses.
//
// 2. PER-AXIS, over the PER-AXIS MINIMUM extent — never over one orientation.
//    The plan's trap: a per-axis product over any single orientation is a
//    lower bound in disguise, because mixed orientations beat it (13 dominoes
//    fit a 3-cube where the best single-orientation grid packs 9). The valid
//    form tiles the tolerant window into cells of (minExtᵢ+g−EPS) per axis,
//    where minExtᵢ = the smallest extent any option puts on axis i. Two boxes
//    whose min corners share a cell would sit closer than each box's own
//    tolerant reach on every axis — a pair even the judge rejects — so each
//    cell holds at most one box, and every box's min corner lands in a cell
//    (a box needs extent ≥ minExtᵢ of room, which pins its corner inside the
//    tiled region). n ≤ Π floor((usableᵢ+g+2·EPS)/(minExtᵢ+g−EPS)).
//
// 3. WEIGHT: floorTolerant(maxWeightG / weightG) — arrangement cannot recover
//    a weight-capped count, so including it keeps the on-screen gap between
//    achieved and bound an honest "what a better arrangement could gain".
//
// The bound is min of the three. It can be Infinity — a weightless zero-extent
// unit really has no finite cap — and the orchestrator represents that as an
// ABSENT field rather than inventing a number (Infinity does not survive the
// saved-estimate JSON round-trip, and any finite stand-in would be a lie).
//
// Float discipline: the per-axis component uses the grid engine's own
// floorTolerant, so an exact fit that lands a hair under in binary rounds the
// same way in the bound as in the count. The volumetric component's ratio is
// the PRODUCT of three per-axis ratios, so its rescue nudge must compound the
// same way — (1+1e-9)³, not (1+1e-9) — or the grid can rescue each axis while
// the volumetric floor lands one below the count (the second adversarial-
// verify refutation: 922 crafted inputs where the raw bound sat at count − 1,
// masked only by the orchestrator's clamp). A bound may be loose by one,
// never below the count — loosening is safe, any value ≥ the true maximum is
// still a bound. Clearances are sanitized exactly as extremePointFit
// sanitizes them; garbage orientations (non-finite or negative extents) are
// ignored, matching the engines that refuse to place them.

/** True when every extent component is a real, non-negative length. */
function isPlaceable(extent: Vec3): boolean {
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(extent[a]) || extent[a] < 0) return false
  }
  return true
}

/**
 * Can a box of this extent be contained at ALL?
 *
 * The amendment of 2026-09-04 rests entirely on this predicate, so it errs
 * toward INCLUDING an orientation: excluding one that can in fact be placed
 * makes the bound UNSOUND, while including one that cannot only leaves it
 * loose. So it is not written as a comparison of its own — it asks
 * `alongAxis`, the same function that counts, whether this extent admits at
 * least one copy on every axis. A predicate written separately would be a
 * second opinion about the same arithmetic, and the two would eventually
 * disagree in the last ulp.
 *
 * They already did, in the writing of this: a first draft compared
 * `extent > usable + 2·EPS` and excluded a 10000.000007 box from a 10000
 * carton — which `floorTolerant`'s RELATIVE nudge (1e-9, so 1e-5 at that
 * scale) rescues and the grid engine really does place. The bound would have
 * been 0 against an achieved 1. The existing per-axis test caught it in
 * seconds, which is the argument for asking the counting function rather than
 * re-deriving its tolerance.
 *
 * Containment is per-axis and absolute: a box whose extent exceeds the window
 * on one axis cannot be placed anywhere, at any position, in any arrangement.
 * That is what makes the exclusion sound, and it is the whole argument.
 */
function fitsWindow(extent: Vec3, usable: Vec3, gap: number): boolean {
  for (let a = 0; a < 3; a++) {
    if (alongAxis(usable[a], extent[a], gap) < 1) return false
  }
  return true
}

/** Copies that fit along one axis of the tolerant window, given the smallest
 *  extent any option needs there. Infinity when nothing constrains the axis
 *  (zero-or-smaller tolerant cell); 0 when even the tolerant window is
 *  negative (wall clearance beyond what EPS forgives). */
function alongAxis(usable: number, minExtent: number, gap: number): number {
  if (usable < -2 * EPS) return 0
  const cell = minExtent + gap - EPS
  if (cell <= 0) return Infinity
  const n = floorTolerant((usable + gap + 2 * EPS) / cell)
  return n > 0 ? n : 0
}

/**
 * The bound, and the bound with the weight cap left out of it.
 *
 * WHY THE SECOND NUMBER EXISTS (ADR-0029 phase-2 amendment 2, 2026-09-03).
 * `overall` folds the weight component in, which is right for the figure the
 * results line shows — but it makes the bound useless as evidence about SPACE,
 * because on any weight-capped run the weight term is the minimum and the
 * bound equals the count for a reason that has nothing to do with the carton.
 * A dogfooding AI read `upperBound === count` as "the carton is full too",
 * which is the reasoning this field replaces with an actual measurement:
 * `geometry` is min(volumetric, per-axis) and knows nothing about weight, so
 * `geometry === count` DOES prove no arrangement fits another copy.
 *
 * Both are rigorous in the same sense, and both may be Infinity.
 */
export interface QuantityBounds {
  /** min(volumetric, per-axis, weight) — the number the UI states flatly. */
  overall: number
  /** min(volumetric, per-axis). Never a claim about the weight cap. */
  geometry: number
}

/**
 * Rigorous upper bound on the count for a max-quantity request: no arrangement
 * of `unit` (any mix of its orientation options) that the validator accepts —
 * EPS-tolerant containment, EPS-tolerant gaps, weight under the cap — can
 * exceed it. May return Infinity when no finite bound exists. Returns 0 when
 * the unit has no placeable orientation.
 */
export function quantityUpperBound(
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number
): number {
  return quantityBounds(unit, carton, clearances, maxWeightG).overall
}

/** The same derivation, reporting the geometry-only half beside the whole. */
export function quantityBounds(
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number
): QuantityBounds {
  const wall = Number.isFinite(clearances.wall) ? Math.max(0, clearances.wall) : 0
  const gap = Number.isFinite(clearances.betweenParts) ? Math.max(0, clearances.betweenParts) : 0
  const usable: Vec3 = [carton[0] - 2 * wall, carton[1] - 2 * wall, carton[2] - 2 * wall]

  const placeable = unit.orientations.filter((o) => isPlaceable(o.extent))
  if (placeable.length === 0) return { overall: 0, geometry: 0 }

  // FEASIBLE ORIENTATIONS ONLY (ADR-0022 amendment, 2026-09-04) — the whole of
  // this amendment, in one filter.
  //
  // Both components below take a MINIMUM over options: the smallest inflated
  // volume, and the smallest extent on each axis. An orientation that cannot
  // be contained at all still lowered those minima, and on a flat part it
  // lowered them catastrophically: for a 180×150×20 plate in a carton whose
  // usable depth is 88.9, the three per-axis minima all become 20 — the
  // thickness — because SOME permutation puts the thin side on each axis.
  // The per-axis bound came out 8×7×3 = 168 and never bound anything, leaving
  // the volume ratio (5) to answer a question three readers could settle by
  // hand (3). Over feasible orientations the minima are (150,150,20) and the
  // product is 1×1×3 = 3, exactly.
  //
  // Sound because containment is per-axis and absolute: an orientation whose
  // extent exceeds the tolerant window on any axis cannot be placed at any
  // position, so no accepted arrangement contains a box using it, so it cannot
  // be the orientation whose extent or volume some placed box realises.
  // Excluding it removes a lower bound that no box could ever have attained.
  //
  // Applied to BOTH components rather than only the per-axis one, since the
  // argument is about which orientations can appear and says nothing about
  // which term reads them. On axis-aligned options the volumetric term does not
  // move (a permutation has the same volume); on thorough-tier options, where
  // an OBB candidate and an AABB candidate have genuinely different volumes, it
  // can — and only ever downward.
  const options = placeable.filter((o) => fitsWindow(o.extent, usable, gap))
  if (options.length === 0) return { overall: 0, geometry: 0 }

  // Volumetric: smallest tolerant volume any option consumes. Per-axis factors
  // clamp at 0 — an axis the pair tolerance fully forgives contributes no
  // separating volume, and a negative factor would flip the product's sign.
  let minInflatedVolume = Infinity
  for (const o of options) {
    const v =
      Math.max(0, o.extent[0] + gap - EPS) *
      Math.max(0, o.extent[1] + gap - EPS) *
      Math.max(0, o.extent[2] + gap - EPS)
    if (v < minInflatedVolume) minInflatedVolume = v
  }
  let volumetric: number
  if (usable[0] < -2 * EPS || usable[1] < -2 * EPS || usable[2] < -2 * EPS) {
    volumetric = 0
  } else if (minInflatedVolume <= 0) {
    volumetric = Infinity
  } else {
    const windowVolume =
      (usable[0] + gap + 2 * EPS) * (usable[1] + gap + 2 * EPS) * (usable[2] + gap + 2 * EPS)
    // The cubed nudge is the fix for the compounding refutation — see the
    // float-discipline note in the module doc.
    volumetric = Math.floor((windowVolume / minInflatedVolume) * (1 + 1e-9) ** 3)
  }

  // Per-axis, over the per-axis minimum extent across FEASIBLE options.
  let perAxis = 1
  for (let a = 0; a < 3; a++) {
    let minExtent = Infinity
    for (const o of options) {
      if (o.extent[a] < minExtent) minExtent = o.extent[a]
    }
    perAxis *= alongAxis(usable[a], minExtent, gap)
    if (perAxis === 0) break
  }
  // 0 · Infinity = NaN: a dead axis zeroes the bound no matter how free the
  // others are.
  if (Number.isNaN(perAxis)) perAxis = 0

  const weight =
    Number.isFinite(unit.weightG) && unit.weightG > 0
      ? floorTolerant(maxWeightG / unit.weightG)
      : Infinity

  // Split deliberately: `geometry` must never see `weight`, or it stops being
  // evidence about the carton (see QuantityBounds).
  const geometry = Math.min(volumetric, perAxis)
  const overall = Math.min(geometry, weight)
  return {
    overall: Number.isFinite(overall) ? overall : Infinity,
    geometry: Number.isFinite(geometry) ? geometry : Infinity
  }
}
