import { EPS } from '../geometry'
import type { Clearances, Placement, Vec3 } from './types'

// An independent judge of placement output (ADR-0022 phase 1). It answers one
// question — is this arrangement physically real, and does it honor the gaps the
// user asked for? — WITHOUT consulting the placer that produced it. That
// independence is the whole point. The shelf and grid engines are overlap-free by
// construction (cursor and index arithmetic; neither contains a collision test),
// so extreme-point placement will be the first code here that can be geometrically
// wrong. It needs a judge that shares none of its reasoning. Two callers depend on
// that: the crash barrier discards EP output that fails here (ADR-0022 §2), and the
// differential fuzz asserts every EP placement passes.
//
// TWO SEMANTIC DECISIONS, fixed here because everything downstream inherits them.
//
// 1. TOUCHING IS NOT OVERLAPPING. Parts packed with zero clearance share faces
//    exactly — the grid engine's copy i ends where copy i+1 begins — and those are
//    two separate float computations that can disagree in the last bits. So
//    interpenetration must exceed `tolerance` before it counts. The default is EPS,
//    the same absolute mm-scale epsilon the engines already compare limits with
//    (`fitsLe` in shelfFit, the weight cap in quantityGrid). The margin is not
//    close: float64 noise at carton scale is ~1e-13 mm, while a real placement bug
//    interpenetrates by millimetres. The tolerance forgives the first and cannot
//    hide the second.
//
// 2. CLEARANCES ARE CHECKED, BUT KEPT APART FROM PHYSICS. Two parts 1 mm apart when
//    3 mm of foam was asked for is a broken promise; two parts sharing the same
//    cubic centimetre is an impossible answer. Both are violations and the fuzz
//    should fail on either — but only the second means the arrangement cannot
//    exist. They carry distinct kinds, and `isPhysicallyImpossible` splits them, so
//    the crash barrier can be strict about reality without having to adopt an
//    opinion about dunnage. Pass `clearances` to check them; omit it to ask only
//    whether the boxes are real.
//
// Cost is O(n log n) plus the axis-overlapping pairs, via a sweep along the axis the
// placements are most spread over. That is comfortable at fit-check scale (tens of
// parts) and acceptable at the 50 000-placement ceiling quantity mode materializes
// (MAX_GRID_PLACEMENTS). If it ever shows up in a profile, bucketing into a uniform
// grid is the next step — the contract above would not change.

export type ViolationKind =
  /** Two parts interpenetrate. Physically impossible. */
  | 'overlap'
  /** A part is not wholly inside the carton's inner dimensions. Impossible. */
  | 'outside-carton'
  /** A box with non-finite or inverted coordinates. Impossible, and usually a bug
   *  upstream of placement (a NaN extent, a mis-signed rotation). */
  | 'degenerate-box'
  /** Two parts are disjoint but closer than `clearances.betweenParts`. */
  | 'clearance-parts'
  /** A part is inside the carton but closer to a wall than `clearances.wall`. */
  | 'clearance-wall'

export interface PlacementViolation {
  kind: ViolationKind
  /** Index into the placements array. For pairwise kinds, the lower index. */
  indexA: number
  /** The other placement, for `overlap` and `clearance-parts` only. */
  indexB?: number
  /** How far short the arrangement falls, in mm: penetration depth for `overlap`,
   *  the shortfall for the clearance kinds, the escape distance for
   *  `outside-carton`. Always positive; absent for `degenerate-box`. */
  shortfallMm?: number
  /** Test-readable sentence naming the parts and the number. */
  detail: string
}

/** The kinds that mean the arrangement cannot exist, as opposed to falling short of
 *  a requested gap. The crash barrier keys on this. */
export function isPhysicallyImpossible(violation: PlacementViolation): boolean {
  return (
    violation.kind === 'overlap' ||
    violation.kind === 'outside-carton' ||
    violation.kind === 'degenerate-box'
  )
}

export interface ValidateOptions {
  /** Check the requested gaps too. Omit to ask only whether the boxes are real. */
  clearances?: Clearances
  /** Stop once this many violations are found. The crash barrier passes 1, since it
   *  only needs to know whether to discard. Omit to collect all of them. */
  limit?: number
  /** Absolute tolerance in mm (see decision 1). Defaults to EPS. */
  tolerance?: number
}

/** Largest per-axis separation between two boxes. Positive ⇒ they are disjoint,
 *  with that much space on their best separating axis. Negative ⇒ they
 *  interpenetrate, and its magnitude is the shallowest depth that separates them. */
function separation(a: Placement, b: Placement): number {
  let best = -Infinity
  for (let axis = 0; axis < 3; axis++) {
    const gap = Math.max(a.boxMin[axis] - b.boxMax[axis], b.boxMin[axis] - a.boxMax[axis])
    if (gap > best) best = gap
  }
  return best
}

function isDegenerate(p: Placement, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const lo = p.boxMin[axis]
    const hi = p.boxMax[axis]
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true
    // Inverted, beyond tolerance. A zero-extent box is NOT flagged: a genuinely
    // flat part rotated into an axis plane is legal, and quantityGrid already has
    // the relative bar for extents too thin to pack.
    if (hi < lo - tolerance) return true
  }
  return false
}

/** The axis the placements are most spread along — the best one to sweep, because
 *  it produces the fewest overlapping intervals. */
function sweepAxis(placements: readonly Placement[]): number {
  let bestAxis = 0
  let bestSpread = -Infinity
  for (let axis = 0; axis < 3; axis++) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of placements) {
      const v = p.boxMin[axis]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const spread = hi - lo
    if (Number.isFinite(spread) && spread > bestSpread) {
      bestSpread = spread
      bestAxis = axis
    }
  }
  return bestAxis
}

/**
 * Check an arrangement against the carton and, optionally, the requested clearances.
 * Returns every violation found (empty ⇒ valid). Placements are identified by index,
 * so a caller can map back to the part that owns one.
 *
 * `carton` is inner dimensions in mm, matching the strategies: a part is contained
 * when it sits within [0, carton] on every axis, or within [wall, carton − wall]
 * when wall clearance is being checked.
 */
export function validatePlacements(
  placements: readonly Placement[],
  carton: Vec3,
  options: ValidateOptions = {}
): PlacementViolation[] {
  const tolerance = options.tolerance ?? EPS
  const limit = options.limit ?? Infinity
  const wall = options.clearances?.wall ?? 0
  const requiredGap = options.clearances?.betweenParts ?? 0

  const violations: PlacementViolation[] = []
  const full = (): boolean => violations.length >= limit

  // --- per-box: degeneracy and containment, in index order -----------------
  const sane: number[] = []
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]
    if (isDegenerate(p, tolerance)) {
      violations.push({
        kind: 'degenerate-box',
        indexA: i,
        detail: `${p.partName} has a non-finite or inverted box: [${p.boxMin.join(', ')}] → [${p.boxMax.join(', ')}]`
      })
      if (full()) return violations
      continue // its coordinates cannot be reasoned about; keep it out of the sweep
    }
    sane.push(i)

    for (let axis = 0; axis < 3; axis++) {
      const escape = Math.max(-p.boxMin[axis], p.boxMax[axis] - carton[axis])
      if (escape > tolerance) {
        violations.push({
          kind: 'outside-carton',
          indexA: i,
          shortfallMm: escape,
          detail: `${p.partName} extends ${escape.toFixed(3)} mm outside the carton on axis ${axis}`
        })
        if (full()) return violations
        break // one report per part is enough; the arrangement is already invalid
      }
      // Inside the carton, but is it clear of the wall by the requested padding?
      if (wall > 0) {
        const shortfall = Math.max(wall - p.boxMin[axis], p.boxMax[axis] - (carton[axis] - wall))
        if (shortfall > tolerance) {
          violations.push({
            kind: 'clearance-wall',
            indexA: i,
            shortfallMm: shortfall,
            detail: `${p.partName} comes ${shortfall.toFixed(3)} mm closer to the wall than the ${wall} mm clearance on axis ${axis}`
          })
          if (full()) return violations
          break
        }
      }
    }
  }

  // --- pairwise: overlap and part-to-part clearance -------------------------
  // Sweep along the most-spread axis, sorted by box min. Once a later box starts
  // beyond the current one's reach (its max, plus any gap we require), no box after
  // it can violate against the current one either — sorted mins make that safe.
  const axis = sweepAxis(placements)
  const order = [...sane].sort((i, j) => {
    const d = placements[i].boxMin[axis] - placements[j].boxMin[axis]
    return d !== 0 ? d : i - j // index tiebreak keeps the sweep deterministic
  })
  const reach = Math.max(0, requiredGap) + tolerance

  const pairwise: PlacementViolation[] = []
  outer: for (let s = 0; s < order.length; s++) {
    const i = order[s]
    const a = placements[i]
    for (let t = s + 1; t < order.length; t++) {
      const j = order[t]
      const b = placements[j]
      if (b.boxMin[axis] - a.boxMax[axis] > reach) continue outer

      const gap = separation(a, b)
      const [lo, hi] = i < j ? [i, j] : [j, i]
      if (gap < -tolerance) {
        pairwise.push({
          kind: 'overlap',
          indexA: lo,
          indexB: hi,
          shortfallMm: -gap,
          detail: `${a.partName} and ${b.partName} interpenetrate by ${(-gap).toFixed(3)} mm`
        })
      } else if (requiredGap > 0 && gap < requiredGap - tolerance) {
        pairwise.push({
          kind: 'clearance-parts',
          indexA: lo,
          indexB: hi,
          shortfallMm: requiredGap - gap,
          detail: `${a.partName} and ${b.partName} are ${Math.max(0, gap).toFixed(3)} mm apart, short of the ${requiredGap} mm clearance`
        })
      }
      if (violations.length + pairwise.length >= limit) break outer
    }
  }

  // Sweep order is deterministic but not index order; sort so callers and tests see
  // a stable, readable sequence. (With `limit`, this orders whichever were found
  // first — still deterministic, since the sweep is.)
  pairwise.sort((x, y) => x.indexA - y.indexA || (x.indexB ?? 0) - (y.indexB ?? 0))
  violations.push(...pairwise)
  return violations.length > limit ? violations.slice(0, limit) : violations
}
