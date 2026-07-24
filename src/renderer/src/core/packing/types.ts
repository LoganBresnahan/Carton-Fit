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
 * Fit-check placement (heterogeneous boxes). Greedy shelf/layer today; extreme-
 * point tomorrow — same signature. Weight is co-equal with fit: the strategy stops
 * on whichever binds and reports which.
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
}

export interface MaxQuantityResult extends PackResultBase {
  mode: 'max-quantity'
  count: number
}

export type PackResult = FitCheckResult | MaxQuantityResult
