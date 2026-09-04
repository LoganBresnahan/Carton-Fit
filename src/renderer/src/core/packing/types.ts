// The packing contract (ADR-0003). Every packing slice — the two tier-1 engines,
// the tier-2 OBB path, the worker, the store, the results UI — consumes these
// types, so this file is the design review point. It anticipates the whole plan
// but implements none of it: no algorithms live here, only shapes.
//
// Conventions fixed here (getting them wrong downstream is SILENT — a mirrored
// mesh or a wrong count still renders plausibly):
//   - All lengths are millimeters, all weights grams (ADR-0004 canonical units).
//   - Vec3 is [x, y, z]. Mat3 is row-major; a rotation acts as v' = M · v.
//   - Orientation matrices are PROPER rotations (det = +1) so a placed mesh is
//     never mirrored — the 6 axis "orientations" of a box are realized by
//     rotations from its symmetry group, not by reflections.
//   - Weight and geometric fit are BOTH hard constraints; every result reports
//     which one was binding (ADR-0004 requirement, threaded as `binding`).

export type Vec3 = readonly [number, number, number]

/** Row-major 3×3; applied as v' = M · v (rows are the output basis). */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Volume of an axis-aligned box given its extent (mm³). */
export function boxVolume(extent: Vec3): number {
  return extent[0] * extent[1] * extent[2]
}

// --- modes & tiers --------------------------------------------------------

/** Fit check: do all parts in the file fit? Max quantity: how many of one unit? */
export type PackMode = 'fit-check' | 'max-quantity'

/** Quality tiers, presented from day one; `nesting` is visible but disabled in v1. */
export type QualityTier = 'fast' | 'thorough' | 'nesting'

export interface ModeInfo {
  mode: PackMode
  label: string
}
export const MODES: readonly ModeInfo[] = [
  { mode: 'fit-check', label: 'Fit check' }, // default (ADR-0003)
  { mode: 'max-quantity', label: 'Max quantity' }
]

export interface TierInfo {
  tier: QualityTier
  label: string
  /** ADR-0003: true nesting ships visible-but-disabled in v1. */
  enabled: boolean
  note?: string
}
export const TIERS: readonly TierInfo[] = [
  { tier: 'fast', label: 'Fast', enabled: true },
  { tier: 'thorough', label: 'Thorough', enabled: true },
  { tier: 'nesting', label: 'True nesting', enabled: false, note: 'Experimental — coming later' }
]

// --- inputs ---------------------------------------------------------------

/** Gaps in millimeters. Both default to 0; the UI collects them per ADR-0004. */
export interface Clearances {
  /** Minimum gap between adjacent parts. */
  betweenParts: number
  /** Minimum gap from any part to the carton wall (applied on every inner face). */
  wall: number
}

/**
 * The clearances an engine actually honors: negative and non-finite gaps clamped
 * to zero, so a nonsense request degrades to "no gap" rather than to an
 * impossible arrangement (a negative gap offsets placements INTO each other; a
 * NaN one silently stops every comparison from rejecting anything).
 *
 * Each engine already clamps identically at its own entry — this is the shared
 * statement of that rule, for the callers that have to ask a QUESTION about an
 * arrangement rather than build one. The crash barrier is the reason it exists:
 * it judges extreme-point output with `validatePlacements`, which takes the
 * clearances at face value, so without this the judge and the engine would be
 * asked different questions on exactly the malformed inputs where the barrier
 * matters most.
 */
export function sanitizeClearances(clearances: Clearances): Clearances {
  const clamp = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)
  return { betweenParts: clamp(clearances.betweenParts), wall: clamp(clearances.wall) }
}

/**
 * One part to pack. Carries the mesh positions (mm) because the tier chooses what
 * to derive: fast uses the AABB extent, thorough runs the OBB search over the
 * point cloud. Weight is grams (direct entry or density × mesh volume, ADR-0004).
 */
export interface PackPart {
  name: string
  positions: Float32Array
  weightG: number
}

/**
 * A packing request. `carton` is INNER dimensions in mm (ADR-0004: inside dims are
 * the physical truth; outer+wall is converted at the UI boundary). In fit-check,
 * `parts` is every part in the file. In max-quantity, `parts` is the single unit to
 * replicate — one selected part, or the whole file pre-composed into one rigid unit.
 */
export interface PackRequest {
  mode: PackMode
  tier: QualityTier
  carton: Vec3
  clearances: Clearances
  /** Hard weight cap in grams (ADR-0004 default: DEFAULT_MAX_WEIGHT_G = 35 lb). */
  maxWeightG: number
  parts: PackPart[]
}

// --- placement strategy seam ----------------------------------------------
// The swappable core: an OrientationProvider turns a part into candidate oriented
// boxes (fast = 6 axis permutations; thorough = OBB-aligned), and a Strategy packs
// those boxes into the carton. A future extreme-point placement is a new Strategy
// with the SAME signature — no contract change. This is why placement is a function
// type, not baked into the engines.

/** One candidate way to place a part: the box extent (mm), the proper rotation that
 *  realizes it, and where that rotated part's AABB min corner sits. A placement's
 *  translation = targetCorner − rotatedMin, so the part's box min lands exactly at
 *  the target grid corner. */
export interface OrientationOption {
  extent: Vec3
  rotation: Mat3
  rotatedMin: Vec3
}

/** A part reduced to its candidate orientations + weight — the strategy's input. */
export interface PackBox {
  name: string
  weightG: number
  orientations: readonly OrientationOption[]
}

/** part → candidate orientations. Fast and thorough differ only in this function. */
export type OrientationProvider = (part: PackPart) => OrientationOption[]

/** A concrete placed instance, enough to both render it and check overlaps. */
export interface Placement {
  partName: string
  /** Proper rotation applied to the part mesh (row-major, v' = M · v). */
  rotation: Mat3
  /** Translation added after rotation, in carton space (mm). */
  translation: Vec3
  /** Resulting AABB in carton space (mm) — for the 3D view and overlap tests. */
  boxMin: Vec3
  boxMax: Vec3
}

/** Which hard constraint limited the result (ADR-0004: always reported). */
export type BindingConstraint = 'geometry' | 'weight'

/** Output of a fit-check strategy: what got placed, what didn't, and why. */
export interface FitPlacement {
  placements: Placement[]
  /** Names of parts that could not be placed (empty ⇒ everything fit). */
  unplaced: string[]
  binding: BindingConstraint
}

/** Output of a max-quantity strategy: how many units fit and where. */
export interface QuantityPlacement {
  count: number
  placements: Placement[]
  binding: BindingConstraint
}

/**
 * Fit-check placement (heterogeneous boxes). Two implementations share this
 * signature — greedy shelf/layer and extreme-point — and pack.ts runs both and
 * returns the better (ADR-0022 §2), which is exactly what the seam was for. Weight
 * is co-equal with fit: the strategy stops on whichever binds and reports which.
 */
export type FitStrategy = (
  boxes: readonly PackBox[],
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number
) => FitPlacement

/** Max-quantity placement: one unit replicated. Picks the orientation that packs
 *  most, then applies the weight cap; `binding` says which limited the count. */
export type QuantityStrategy = (
  unit: PackBox,
  carton: Vec3,
  clearances: Clearances,
  maxWeightG: number
) => QuantityPlacement

// --- results --------------------------------------------------------------

interface PackResultBase {
  tier: QualityTier
  binding: BindingConstraint
  /** ADR-0003: heuristic placement must be LABELED as such, not sold as a proof. */
  heuristic: boolean
  placements: Placement[]
  /** Packed part volume ÷ carton volume, 0..1. */
  utilization: number
}

export interface FitCheckResult extends PackResultBase {
  mode: 'fit-check'
  fits: boolean
  /** Names of parts that didn't fit (drives the results panel). */
  unplaced: string[]
  /** Dimensions (mm) of the largest usable free space left by this arrangement
   *  — usable meaning a part with extents ≤ these dims could sit there
   *  honoring every requested clearance (ADR-0022 §3/§7: "Largest free
   *  space: …"). Present only on a non-fit, and only when the void can be
   *  reported honestly (see ems.ts) — absence over misinformation, like
   *  `upperBound`. Explains THIS attempt's stopping point; never a proof. */
  largestFreeSpace?: Vec3
  /** The smallest part left over, and the extent (mm) of its smallest
   *  orientation — the other half of ADR-0022 §7's non-fit sentence, so the
   *  reader can compare "what is left" against "what the smallest leftover
   *  needs" without doing geometry. Data, not a claim: whether the two triples
   *  are worth putting side by side is the wording layer's gate (a weight-bound
   *  non-fit can leave a part that fits the space perfectly well). Present only
   *  on a non-fit, and only when some unplaced part has a usable orientation. */
  smallestUnplaced?: { name: string; extentMm: Vec3 }
}

export interface MaxQuantityResult extends PackResultBase {
  mode: 'max-quantity'
  count: number
  /** Rigorous cap on the count ANY arrangement could achieve — min of the
   *  volumetric, per-axis, and weight bounds (ADR-0022 §7: "47 fit (upper
   *  bound 54)", stated flatly because it is not a heuristic). Always ≥
   *  `count`. Absent when no finite bound exists (e.g. a weightless
   *  zero-extent unit) — absence survives the saved-estimate JSON round-trip,
   *  where Infinity would not. */
  upperBound?: number
  /** The same bound with the WEIGHT component left out — min(volumetric,
   *  per-axis) alone. It answers the one question `upperBound` cannot: whether
   *  the carton itself is out of room. On a weight-capped count `upperBound`
   *  equals `count` no matter how empty the box is (the weight term is the
   *  minimum), so only this number can tell "the cap stopped a roomy carton"
   *  from "both limits landed on the same figure" — and reporting the first
   *  when it is the second is the defect this field was added to close
   *  (ADR-0029 phase-2 amendment 2). Equality with `count` is a PROOF that no
   *  arrangement fits another copy; a value above `count` proves nothing in
   *  the other direction, because a bound is allowed to be loose. Absent
   *  exactly when a finite one does not exist. */
  geometryBound?: number
  /** How many the same search places with the weight cap LIFTED (ADR-0033).
   *  The half of the question `geometryBound` cannot answer: a bound above the
   *  count proves nothing, but an arrangement of more copies is a constructive
   *  proof that the carton has room — and equality is honest heuristic
   *  evidence that it does not, which is a weaker claim and must be worded as
   *  one. Always ≥ `count`.
   *
   *  ALWAYS PRESENT (addendum 3, 6th dogfood), which is not the same as
   *  "a rerun always runs" — it almost never does. Three of the four ways to
   *  reach an answer already know it without packing anything twice: a
   *  geometry-bound count IS its own cap-free count (the cap that did not bind
   *  hid nothing); a count with no finite cap is cap-free by definition; and a
   *  weight-bound count whose `geometryBound` MEETS it cannot grow, because
   *  the bound forbids more and lifting a cap never places fewer — so the
   *  value is the count, provable rather than searched. Only the fourth case,
   *  a weight-bound count with room left in the bound, pays for a second pack.
   *
   *  It was optional until the last of those three was reported as absent
   *  rather than derived, which is how a reader lost the corroborating field
   *  at exactly the tie where they wanted a second opinion. Skipping the rerun
   *  was right; withholding the answer was not. */
  spaceOnlyCount: number
}

export type PackResult = FitCheckResult | MaxQuantityResult
