import type {
  Clearances,
  OrientationOption,
  PackBox,
  Placement,
  QuantityPlacement,
  QuantityStrategy,
  Vec3
} from './types'

// fast-grid-fill-quantity (ADR-0003): how many copies of one unit fit, packed on a
// regular grid. For each candidate orientation, count a 3D grid of the box inside the
// carton's usable interior, pick the orientation that fits the most, then apply the
// weight cap and report which constraint was binding (ADR-0004).

/** Count of size-`e` boxes that fit along a `usable`-length run with `gap` between
 *  them. From n·e + (n−1)·gap ≤ usable, so n = floor((usable + gap) / (e + gap)).
 *  Guards the edge cases the plan calls out: exact fit, off-by-one, e larger than
 *  usable, and non-positive usable. */
function countAlong(usable: number, e: number, gap: number): number {
  if (usable <= 0 || e <= 0) return 0
  const n = Math.floor((usable + gap) / (e + gap))
  return n > 0 ? n : 0
}

interface GridFit {
  counts: [number, number, number]
  total: number
  option: OrientationOption
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
    const counts: [number, number, number] = [
      countAlong(usable[0], option.extent[0], clearances.betweenParts),
      countAlong(usable[1], option.extent[1], clearances.betweenParts),
      countAlong(usable[2], option.extent[2], clearances.betweenParts)
    ]
    const total = counts[0] * counts[1] * counts[2]
    if (!best || total > best.total) best = { counts, total, option }
  }
  return best
}

/** Weight-limited copy count. A weightless unit is never weight-bound (Infinity). */
function weightCapacity(unitWeightG: number, maxWeightG: number): number {
  if (unitWeightG <= 0) return Infinity
  return Math.floor(maxWeightG / unitWeightG)
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
    grid && count > 0 ? gridPlacements(unit, grid.option, grid.counts, clearances, count) : []

  return { count, placements, binding }
}
