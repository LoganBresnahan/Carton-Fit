import { EPS } from '../geometry'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  Placement,
  QuantityPlacement,
  QuantityStrategy,
  Vec3
} from './types'

/** `count` always reports the true number, but only this many placements are
 *  materialized: a weightless 1 mm part in a 600 mm carton counts 2e8 copies,
 *  and building an object per copy OOMs long before any renderer could draw
 *  them. Phase 5's results layer decides how to present a truncated layout. */
export const MAX_GRID_PLACEMENTS = 50_000

// fast-grid-fill-quantity (ADR-0003): how many copies of one unit fit, packed on a
// regular grid. For each candidate orientation, count a 3D grid of the box inside the
// carton's usable interior, pick the orientation that fits the most, then apply the
// weight cap and report which constraint was binding (ADR-0004).

/** Count of size-`e` boxes that fit along a `usable`-length run with `gap` between
 *  them. From n·e + (n−1)·gap ≤ usable, so n = floor((usable + gap) / (e + gap)).
 *  Guards the edge cases the plan calls out: exact fit, off-by-one, e larger than
 *  usable, and non-positive usable. Extents at or below `degenerate` count as
 *  zero, not as near-infinite packability (see bestGrid). */
function countAlong(usable: number, e: number, gap: number, degenerate: number): number {
  if (usable <= 0 || e <= degenerate) return 0
  // Tolerant floor for the same reason as the weight cap: inch-derived
  // dimensions can make an exact fit land a hair under in binary.
  const n = floorTolerant((usable + gap) / (e + gap))
  return n > 0 ? n : 0
}

interface GridFit {
  counts: [number, number, number]
  total: number
  option: OrientationOption
}

/** Degenerate-extent bar, RELATIVE to the part's own scale: float32
 *  quantization leaves ~(size × 6e-8) of residual thickness on a rotated flat
 *  part — a 30 mm sheet came back 1.4e-6 mm "thick" and dividing by it produced
 *  a 1.8e8 count that OOMed the process (verify finding). 1e-5 of the largest
 *  extent sits well above that noise and well below any real feature (a 1000 mm
 *  sheet 0.1 mm thick is 1e-4 of its size).
 *
 *  Exported for quantityRefine (ADR-0022 §4): EP refinement must refuse the
 *  same noise-thin orientations this engine refuses, or "refinement" would
 *  un-do the guard by placing thousands of float-noise sheets the grid
 *  deliberately counted as zero. */
export function degenerateExtentBar(extent: Vec3): number {
  return Math.max(EPS, Math.max(extent[0], extent[1], extent[2]) * 1e-5)
}

/** Best-fitting orientation and its per-axis grid counts. */
function bestGrid(unit: PackBox, carton: Vec3, clearances: Clearances): GridFit | null {
  const usable: Vec3 = [
    carton[0] - 2 * clearances.wall,
    carton[1] - 2 * clearances.wall,
    carton[2] - 2 * clearances.wall
  ]
  let best: GridFit | null = null
  for (const option of unit.orientations) {
    const [ex, ey, ez] = option.extent
    const degenerate = degenerateExtentBar(option.extent)
    const counts: [number, number, number] = [
      countAlong(usable[0], ex, clearances.betweenParts, degenerate),
      countAlong(usable[1], ey, clearances.betweenParts, degenerate),
      countAlong(usable[2], ez, clearances.betweenParts, degenerate)
    ]
    const total = counts[0] * counts[1] * counts[2]
    if (!best || total > best.total) best = { counts, total, option }
  }
  return best
}

/**
 * Floor a ratio that ought to be exact, tolerating binary representation error.
 *
 * Unit conversion makes this necessary, not paranoid: a 5 lb cap with 0.01 lb
 * parts is exactly 500 in decimal, but as canonical grams (2267.96185 /
 * 4.5359237) it lands a hair BELOW 500 in binary, and a bare floor reports 499.
 * The nudge is relative (1e-9), so it only rescues values already within a
 * rounding error of an integer — at carton scale that is sub-nanometre, far
 * under the EPS the placement engines use.
 *
 * Exported for quantityBound (ADR-0022): the upper bound must never fall below
 * this engine's count, and sharing the exact floor arithmetic is what keeps a
 * tolerant boundary from inverting them by one.
 */
export function floorTolerant(ratio: number): number {
  return Math.floor(ratio * (1 + 1e-9))
}

/** Weight-limited copy count. A weightless unit is never weight-bound
 *  (Infinity). Exported for quantityRefine, which must attribute binding by
 *  the same arithmetic this engine uses — two floors that differ in the last
 *  ulp would let the refined result flip 'weight' to 'geometry' on the same
 *  numbers. */
export function weightCapacity(unitWeightG: number, maxWeightG: number): number {
  if (unitWeightG <= 0) return Infinity
  return floorTolerant(maxWeightG / unitWeightG)
}

function gridPlacements(
  unit: PackBox,
  option: OrientationOption,
  counts: [number, number, number],
  clearances: Clearances,
  limit: number
): Placement[] {
  const gap = clearances.betweenParts
  const [ex, ey, ez] = option.extent
  const placements: Placement[] = []
  for (let k = 0; k < counts[2] && placements.length < limit; k++) {
    for (let j = 0; j < counts[1] && placements.length < limit; j++) {
      for (let i = 0; i < counts[0] && placements.length < limit; i++) {
        const corner: Vec3 = [
          clearances.wall + i * (ex + gap),
          clearances.wall + j * (ey + gap),
          clearances.wall + k * (ez + gap)
        ]
        placements.push({
          partName: unit.name,
          rotation: option.rotation,
          translation: [
            corner[0] - option.rotatedMin[0],
            corner[1] - option.rotatedMin[1],
            corner[2] - option.rotatedMin[2]
          ],
          boxMin: corner,
          boxMax: [corner[0] + ex, corner[1] + ey, corner[2] + ez]
        })
      }
    }
  }
  return placements
}

export const gridFillQuantity: QuantityStrategy = (unit, carton, clearances, maxWeightG) => {
  const grid = bestGrid(unit, carton, clearances)
  const geometryCount = grid ? grid.total : 0
  const weightCount = weightCapacity(unit.weightG, maxWeightG)

  const count = Math.min(geometryCount, weightCount)
  // Nothing fits spatially ⇒ geometry binds regardless of weight. Otherwise the
  // smaller cap binds; a tie (weight cap == geometry cap) reports 'weight', the
  // user-facing limit.
  const binding: QuantityPlacement['binding'] =
    geometryCount === 0 ? 'geometry' : weightCount <= geometryCount ? 'weight' : 'geometry'

  const placements =
    grid && count > 0
      ? gridPlacements(unit, grid.option, grid.counts, clearances, Math.min(count, MAX_GRID_PLACEMENTS))
      : []

  return { count, placements, binding }
}
