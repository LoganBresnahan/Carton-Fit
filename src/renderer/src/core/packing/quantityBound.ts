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
  const wall = Number.isFinite(clearances.wall) ? Math.max(0, clearances.wall) : 0
  const gap = Number.isFinite(clearances.betweenParts) ? Math.max(0, clearances.betweenParts) : 0
  const usable: Vec3 = [carton[0] - 2 * wall, carton[1] - 2 * wall, carton[2] - 2 * wall]

  const options = unit.orientations.filter((o) => isPlaceable(o.extent))
  if (options.length === 0) return 0

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

  // Per-axis, over the per-axis minimum extent across options.
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

  const bound = Math.min(volumetric, perAxis, weight)
  return Number.isFinite(bound) ? bound : Infinity
}
