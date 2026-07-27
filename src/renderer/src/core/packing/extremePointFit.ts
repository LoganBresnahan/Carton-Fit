import { EPS } from '../geometry'
import { boxVolume } from './types'
import type {
  BindingConstraint,
  Clearances,
  FitPlacement,
  FitStrategy,
  OrientationOption,
  PackBox,
  Placement,
  Vec3
} from './types'

// extreme-point-fitcheck (ADR-0022): the challenger placement engine, behind the
// same FitStrategy seam as greedyShelfFit. Where shelf's cursors only move forward
// — abandoning the space above short parts and the ragged ends of rows — this
// engine keeps a set of candidate corner points and tries every part at every
// point in every orientation, with a real overlap check. It is the first placement
// code here that CAN be geometrically wrong, which is why it exists alongside the
// validator (validate.ts) and not instead of shelf: shelf stays as incumbent,
// oracle, and crash barrier (ADR-0022 §2). pack.ts RACES it against shelf and
// returns the better of the two, so this engine can only improve an answer,
// never worsen one.
//
// A deterministic operation backstop bounds the search (ADR-0022 §6 — a count,
// never a clock). See DEFAULT_MAX_EP_OPS for what is charged and how it was
// sized; the abort is clean, leaving a valid truncated arrangement rather than a
// suspect one.
//
// The safety split that shapes everything below: CANDIDATE GENERATION AFFECTS
// QUALITY, NEVER VALIDITY. Every candidate is re-checked at placement time against
// the carton bounds and every placed box, so a missed or misprojected spawn point
// costs packing density, not correctness. That is what makes the heuristic parts
// of this file (projection, pruning) safe to tune later without re-verifying the
// engine's physics.
//
// Clearance semantics reproduce shelfFit's, without double-counting: the wall gap
// shrinks the usable window to [wall, carton − wall] per axis, and the
// between-parts gap applies only pairwise — a part sitting against the wall
// consumes no trailing gap. Spawn points are offset by the gap along the face
// normal only; the other two axes inherit the placed box's own min corner, since
// max-axis separation needs just one clear axis.
//
// Determinism regime (ADR-0022 consequence — a requirement, not a nice-to-have):
// stable sorts with the sorted-extent volume (shelf's ulp lesson), candidates
// kept in insertion order and deduped by exact coordinate key, best-candidate
// selection by strictly-better replacement so ties keep the earliest, no
// Math.random, no Map iteration. Same input, same placements, every run.
//
// Weight is co-equal with geometry (ADR-0004), same protocol as shelf: find a
// spot FIRST, then test the cumulative cap, so a part that fits nowhere is a
// geometry rejection and a part that fits but breaks the cap is a weight
// rejection that consumes no space. Binding attribution is shelf's, verbatim.

export type EpScoringRule = 'deepest-bottom-left' | 'best-fit-volume'

/** Options the engine accepts beyond the FitStrategy seam's four arguments. Both
 *  are engine-internal knobs, which is why they live behind one optional object
 *  rather than growing the shared strategy signature. */
export interface EpOptions {
  scoring?: EpScoringRule
  /** Deterministic operation budget (ADR-0022 §6). See DEFAULT_MAX_EP_OPS. */
  maxOps?: number
}

/** What the engine returns beyond a plain FitPlacement: the work it actually did,
 *  and whether the backstop cut the search short. Structurally still a
 *  FitPlacement, so the function satisfies FitStrategy unchanged. */
export interface EpFitPlacement extends FitPlacement {
  /** Operations charged — pairwise box tests plus candidate evaluations. */
  ops: number
  /** True when `maxOps` was exhausted and the search abandoned the remaining
   *  boxes. The placements returned are still valid; the arrangement is just
   *  truncated, so a tripped result loses the incumbent race on its own merits
   *  rather than needing to be special-cased. */
  backstopTripped: boolean
}

/** Provisional default until phase 3's differential fuzz measures both rules on
 *  the samples/ parts (ADR-0022 "Open at build time"). The switch exists so
 *  settling the rule is a one-line change that reopens nothing verified here.
 *  - deepest-bottom-left: lexicographic min (z, y, x) of the candidate corner.
 *  - best-fit-volume: min volume of the packed envelope (the AABB from the wall
 *    corner over everything placed, candidate included) — compactness, directly.
 */
export const DEFAULT_EP_SCORING: EpScoringRule = 'deepest-bottom-left'

/** The deterministic operation backstop (ADR-0022 §6): a COUNT, never a clock, so
 *  the same input trips — or doesn't — identically on every machine and every run.
 *
 *  One "operation" is one unit of the work that actually dominates this engine:
 *  each candidate (point × orientation) evaluated, plus each pairwise test against
 *  an already-placed box (clearance, dead-point, projection). Charging the pairwise
 *  tests rather than only the candidates is what makes the budget track cost — the
 *  search is ~O(points × orientations × placed), and only the last factor is
 *  invisible from the outside.
 *
 *  SIZED BY MEASUREMENT, not by guess (build plan risk 2). Measured 2026-07-27 on
 *  the dev machine, seeded heterogeneous loads in snug cartons, throughput a
 *  steady ~1e5 ops/ms:
 *
 *      AS1 golden, 18 real solids, 24 in carton    4.6e4 ops      5 ms
 *      50 mixed parts                              1.2e6 ops     17 ms
 *      100 mixed parts                             1.1e7 ops    123 ms
 *      250 mixed parts                             1.8e8 ops    1.9 s
 *      500 mixed parts                             1.5e9 ops     15 s
 *
 *  The number that binds is RESPONSIVENESS, not safety — §4 makes the backstop the
 *  bound on quantity-mode refinement cost as well, and the growth above is why:
 *  ops go up with the cube of the part count, so there is no budget that is both
 *  generous to 500 parts and quick. 2e8 buys roughly two seconds at the measured
 *  throughput, which covers every realistic fit check with room to spare — the
 *  real-world anchor spends 0.02% of it, and 100 parts (already an unusual file,
 *  since every solid was modelled by hand) spend 5%. Past ~250 parts the search
 *  truncates and the incumbent's answer stands.
 *
 *  A mis-sized constant degrades depth, never correctness: the incumbent's answer
 *  is still standing (ADR-0022 §2) and every placement made before the trip is
 *  validator-clean. If a dogfooded load ever reads as a hang, this constant is the
 *  tuning knob ADR-0022 §5 names — not a spinner. */
export const DEFAULT_MAX_EP_OPS = 2e8

/** Tolerant ≤, in the SUBTRACTION shape the validator uses (`a − b > EPS` flags).
 *  The additive shape `a <= b + EPS` is not equivalent: when `b + EPS` rounds up,
 *  a ~1e-16 window opens where the engine would admit a placement the validator
 *  calls outside-carton — found by adversarial verify, since the crash barrier
 *  treats any such disagreement as a defect. Same floats, same verdicts. */
const fitsLe = (a: number, b: number): boolean => a - b <= EPS

/** Mirrors shelfFit's orientation preference — lexicographic (z, y, x) extent,
 *  prefer lying flat — so orientation ties resolve identically across engines.
 *  Equal extents return false, and strictly-better replacement then keeps the
 *  earlier option, pinning rotation choice to the provider's list order. */
function preferOption(a: OrientationOption, b: OrientationOption): boolean {
  if (a.extent[2] !== b.extent[2]) return a.extent[2] < b.extent[2]
  if (a.extent[1] !== b.extent[1]) return a.extent[1] < b.extent[1]
  return a.extent[0] < b.extent[0]
}

/** Sorted-extent volume (shelf's ulp lesson): a left-to-right product is
 *  permutation-sensitive in the last ulp, which would let two same-dim parts
 *  swap order just because their orientation lists start differently. */
function sortedVolume(b: PackBox): number {
  if (b.orientations.length === 0) return 0
  const e = [...b.orientations[0].extent].sort((x, y) => x - y)
  const v = e[0] * e[1] * e[2]
  // NaN would make the volume-order comparator inconsistent, and an inconsistent
  // comparator's sort order is implementation-defined — garbage geometry must
  // degrade deterministically, not per-engine. Rank it as unplaceable instead.
  return Number.isFinite(v) ? v : 0
}

/** For a projection along `axis`, the two perpendicular axes. */
const OTHER_AXES: readonly (readonly [number, number])[] = [
  [1, 2],
  [0, 2],
  [0, 1]
]

interface PlacedBox {
  min: Vec3
  max: Vec3
}

/** A scored candidate: corner point, orientation, and (for best-fit-volume) the
 *  envelope volume the placement would produce. */
interface Candidate {
  point: Vec3
  option: OrientationOption
  envVolume: number
}

export function extremePointFit(
  boxes: readonly PackBox[],
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number,
  options: EpOptions = {}
): EpFitPlacement {
  const scoring = options.scoring ?? DEFAULT_EP_SCORING
  // A non-finite or negative budget would make the trip test meaningless (NaN
  // comparisons are always false — the backstop would silently stop existing).
  // Clamp to the default rather than to zero: a garbled knob must not turn a
  // working engine into one that places nothing.
  const maxOps =
    typeof options.maxOps === 'number' && options.maxOps >= 0 && Number.isFinite(options.maxOps)
      ? options.maxOps
      : DEFAULT_MAX_EP_OPS

  // Charged in the three pairwise loops and once per candidate evaluated. `tripped`
  // latches: once the budget is gone the search only unwinds, never resumes.
  let ops = 0
  let tripped = false
  const charge = (n: number): void => {
    ops += n
    if (ops > maxOps) tripped = true
  }
  // Sanitized at entry: a negative or non-finite clearance reaches this seam
  // through the public Clearances type, and unclamped it becomes interpenetration
  // (a negative gap offsets spawn points INTO placed boxes) or NaN-poisoned
  // comparisons that silently stop rejecting anything. The validator already
  // clamps its `reach` the same way — a nonsense request degrades to "no gap",
  // never to an impossible arrangement.
  const wall = Number.isFinite(clearances.wall) ? Math.max(0, clearances.wall) : 0
  const gap = Number.isFinite(clearances.betweenParts) ? Math.max(0, clearances.betweenParts) : 0

  // Largest volume first; JS sort is stable, so equal volumes keep input order.
  const order = [...boxes].sort((a, b) => sortedVolume(b) - sortedVolume(a))

  const placed: PlacedBox[] = []
  // Candidate corner points, in carton space. Insertion order IS the iteration
  // order; the Set only answers membership (exact-coordinate dedup), never
  // iterates. The wall corner seeds the search.
  let points: Vec3[] = [[wall, wall, wall]]
  // Membership only, never iterated — and never shrunk when points are pruned.
  // That is sound ONLY because `placed` grows monotonically (dead stays dead);
  // if placement removal is ever added, this dedup must learn to forget too.
  const pointKeys = new Set<string>([points[0].join(',')])
  // Max corner of everything placed, for best-fit-volume; grows monotonically
  // from the wall corner, which every candidate point descends from.
  const envelope: [number, number, number] = [wall, wall, wall]

  /** Largest per-axis separation between the candidate box and a placed box —
   *  the validator's metric, so the engine and its judge agree at boundaries. */
  const separation = (p: Vec3, e: Vec3, b: PlacedBox): number => {
    let best = -Infinity
    for (let a = 0; a < 3; a++) {
      const s = Math.max(b.min[a] - (p[a] + e[a]), p[a] - b.max[a])
      if (s > best) best = s
    }
    return best
  }

  /** Can extent `e` sit at `p` — inside the usable window, and at least `gap`
   *  from every placed box (touching allowed at gap 0, sub-EPS noise forgiven)? */
  const clearsAll = (p: Vec3, e: Vec3): boolean => {
    for (let a = 0; a < 3; a++) {
      // An upper-bound test alone lets a −Infinity or negative extent through as
      // an inverted box the validator calls degenerate. Extents must be real,
      // non-negative lengths before any tolerant comparison means anything.
      if (!Number.isFinite(e[a]) || e[a] < 0) return false
      if (!fitsLe(p[a] + e[a], carton[a] - wall)) return false
    }
    charge(placed.length)
    for (const b of placed) {
      if (separation(p, e, b) < gap - EPS) return false
    }
    return true
  }

  /** A point is dead when it lies strictly inside a placed box inflated by the
   *  gap on all six faces: any box with its min corner there would sit closer
   *  than the gap to that box on every axis, so nothing can ever be placed at
   *  it. Strictness (beyond EPS) keeps points ON faces alive — touching is not
   *  overlapping, and a zero-extent part may still land there legally. */
  const isDead = (pt: Vec3): boolean => {
    charge(placed.length)
    for (const b of placed) {
      let inside = true
      for (let a = 0; a < 3; a++) {
        if (pt[a] >= b.max[a] + gap - EPS || pt[a] <= b.min[a] - gap + EPS) {
          inside = false
          break
        }
      }
      if (inside) return true
    }
    return false
  }

  /** Slide `point` toward the wall along `axis` until a placed box (inflated by
   *  the gap) or the wall stops it. Blocking is judged by the point's two
   *  perpendicular coordinates lying within the box's footprint — min face
   *  inclusive, max face exclusive, so a box merely TOUCHED at its far face
   *  does not block. Heuristic on purpose: a wrong landing yields a worse or
   *  wasted candidate, never an invalid placement (see module doc). */
  const project = (point: Vec3, axis: number): Vec3 => {
    const [u, v] = OTHER_AXES[axis]
    let floor = wall
    charge(placed.length)
    for (const b of placed) {
      const landing = b.max[axis] + gap
      if (landing > point[axis] + EPS) continue // at or above the point — not below it
      if (point[u] < b.min[u] - EPS || point[u] >= b.max[u] - EPS) continue
      if (point[v] < b.min[v] - EPS || point[v] >= b.max[v] - EPS) continue
      if (landing > floor) floor = landing
    }
    const out: [number, number, number] = [point[0], point[1], point[2]]
    out[axis] = floor
    return out
  }

  /** Admit a candidate point: inside the window, not dead, not a duplicate. */
  const admit = (pt: Vec3): void => {
    for (let a = 0; a < 3; a++) {
      if (pt[a] - (carton[a] - wall) > EPS) return // nothing can ever start there
    }
    const key = pt.join(',')
    if (pointKeys.has(key)) return
    if (isDead(pt)) return
    pointKeys.add(key)
    points.push(pt)
  }

  /** Envelope volume if extent `e` were placed at `p` (best-fit-volume score).
   *  The factors are SORTED before multiplying — shelf's ulp lesson again: a
   *  fixed-axis product makes mathematically equal envelopes of symmetric
   *  candidates differ in the last ulp on non-dyadic dims, and that noise, not
   *  the documented preferOption fallback, would pick the winner. */
  const envVolumeWith = (p: Vec3, e: Vec3): number => {
    const f = [
      Math.max(envelope[0], p[0] + e[0]) - wall,
      Math.max(envelope[1], p[1] + e[1]) - wall,
      Math.max(envelope[2], p[2] + e[2]) - wall
    ].sort((x, y) => x - y)
    return f[0] * f[1] * f[2]
  }

  /** Deepest-bottom-left order: corner (z, y, x), then orientation preference.
   *  Distinct points never tie (all three coordinates equal ⇒ same deduped
   *  point), so the comparator is total. */
  const dblBetter = (a: Candidate, b: Candidate): boolean => {
    if (a.point[2] !== b.point[2]) return a.point[2] < b.point[2]
    if (a.point[1] !== b.point[1]) return a.point[1] < b.point[1]
    if (a.point[0] !== b.point[0]) return a.point[0] < b.point[0]
    return preferOption(a.option, b.option)
  }

  const better = (a: Candidate, b: Candidate): boolean => {
    if (scoring === 'best-fit-volume' && a.envVolume !== b.envVolume) {
      return a.envVolume < b.envVolume
    }
    return dblBetter(a, b)
  }

  const placements: Placement[] = []
  const unplaced: string[] = []
  let totalWeightG = 0
  let placedVolume = 0
  let weightRejected = false
  let geometryRejected = false

  for (const box of order) {
    // The clean abort path: once the budget is gone, this box and every box after
    // it goes unplaced, untouched. The suffix is abandoned rather than partially
    // searched, so "tripped" means exactly one thing — the arrangement is a prefix
    // of the search, and everything in it was chosen under the full rule set.
    if (tripped) {
      unplaced.push(box.name)
      continue
    }

    let best: Candidate | null = null
    for (const point of points) {
      if (tripped) break
      for (const option of box.orientations) {
        charge(1)
        if (!clearsAll(point, option.extent)) continue
        const candidate: Candidate = {
          point,
          option,
          envVolume: envVolumeWith(point, option.extent)
        }
        if (!best || better(candidate, best)) best = candidate
      }
    }

    if (tripped) {
      // Tripped DURING this box's own search: its candidate scan is incomplete, so
      // `best` is the best of an arbitrary prefix rather than the best available.
      // Drop it — placing it would make the arrangement depend on where the budget
      // happened to run out, and it is not a geometry rejection either.
      unplaced.push(box.name)
      continue
    }
    if (!best) {
      unplaced.push(box.name)
      geometryRejected = true
      continue
    }
    if (totalWeightG + box.weightG > maxWeightG + EPS) {
      // Fits geometrically, breaks the cap: reject WITHOUT consuming the spot.
      unplaced.push(box.name)
      weightRejected = true
      continue
    }

    const [ex, ey, ez] = best.option.extent
    const p = best.point
    const q: Vec3 = [p[0] + ex, p[1] + ey, p[2] + ez]
    placements.push({
      partName: box.name,
      rotation: best.option.rotation,
      translation: [
        p[0] - best.option.rotatedMin[0],
        p[1] - best.option.rotatedMin[1],
        p[2] - best.option.rotatedMin[2]
      ],
      boxMin: [p[0], p[1], p[2]],
      boxMax: q
    })
    placed.push({ min: [p[0], p[1], p[2]], max: q })
    for (let a = 0; a < 3; a++) {
      if (q[a] > envelope[a]) envelope[a] = q[a]
    }
    totalWeightG += box.weightG
    placedVolume += boxVolume(best.option.extent)

    // Prune points the new box killed (filter keeps order — determinism), then
    // spawn its own. The USED point stays if it survives the dead test (it does
    // at gap 0 — it sits on the new box's own faces): only a zero-extent part
    // can legally land there again, and the overlap check is the gate.
    points = points.filter((pt) => !isDead(pt))
    // Three face points, each offset by the gap along its face normal only,
    // then each projected toward the wall along its two perpendicular axes so a
    // later part can nest against earlier ones instead of floating (CPT-style
    // extreme points). Fixed spawn order keeps insertion order deterministic.
    const faceSpawns: readonly (readonly [Vec3, number])[] = [
      [[q[0] + gap, p[1], p[2]], 0],
      [[p[0], q[1] + gap, p[2]], 1],
      [[p[0], p[1], q[2] + gap], 2]
    ]
    for (const [corner, normal] of faceSpawns) {
      admit(corner)
      for (const axis of OTHER_AXES[normal]) {
        admit(project(corner, axis))
      }
    }
  }

  // Binding attribution — shelfFit's convention, verbatim: a weight rejection
  // wins over geometry when both occurred (the user-facing limit); with
  // everything placed, report the constraint with the least headroom, and never
  // call a weightless packing weight-bound (0 ≥ 0 is a degenerate tie).
  // A backstop trip joins geometry here: parts are unplaced and the cap did not
  // reject them. Leaving it out would fall through to the headroom comparison,
  // which assumes everything was placed and could label a truncated arrangement
  // 'weight' — a confident wrong answer about which constraint bound.
  let binding: BindingConstraint
  if (weightRejected) binding = 'weight'
  else if (geometryRejected || tripped) binding = 'geometry'
  else {
    const cartonVolume = boxVolume(carton)
    const weightFraction = maxWeightG > 0 ? totalWeightG / maxWeightG : 0
    const volumeFraction = cartonVolume > 0 ? placedVolume / cartonVolume : 0
    binding = weightFraction > 0 && weightFraction >= volumeFraction ? 'weight' : 'geometry'
  }

  return { placements, unplaced, binding, ops, backstopTripped: tripped }
}

// The 4-arg strategy shape pack.ts consumes; the 5th (options) parameter is
// engine-internal and optional, and the extra return fields are additive, so the
// function itself satisfies the seam.
extremePointFit satisfies FitStrategy
