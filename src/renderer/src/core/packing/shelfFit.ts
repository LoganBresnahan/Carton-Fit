import { EPS } from '../geometry'
import { boxVolume } from './types'
import type {
  BindingConstraint,
  FitStrategy,
  OrientationOption,
  PackBox,
  Placement,
  Vec3
} from './types'

// fast-greedy-shelf-fitcheck (ADR-0003): can this heterogeneous set of boxes fit?
// Greedy shelf/row/layer placement — rows run along X, shelves stack along Y
// within a layer, layers stack along Z — with per-part best-of-N orientation.
// Boxes are placed largest-volume-first (the ADR's "sorted by volume").
//
// Overlap-freedom is BY CONSTRUCTION, not by check: within a shelf, x-intervals
// are disjoint (cursor + gap); a shelf's depth is the max y-extent placed in it,
// so the next shelf starts clear of everything; a layer's height is the max
// z-extent, so the next layer starts clear. Only the CURRENT shelf/layer may
// grow, and growth is bounded by the usable interior, so earlier rows are never
// invaded.
//
// Weight is CO-EQUAL with geometry (ADR-0004): a box that fits geometrically
// but would break the cumulative cap is rejected without consuming space, and
// the result reports which constraint actually bound.
//
// This is a heuristic: a greedy "doesn't fit" is not a proof of non-fit, which
// is why FitCheckResult carries the `heuristic` flag downstream (ADR-0003).

interface Spot {
  kind: 'row' | 'new-shelf' | 'new-layer'
  x: number
  y: number
  z: number
  option: OrientationOption
}

const fitsLe = (a: number, b: number): boolean => a <= b + EPS

/** Lexicographic (z, y, x) extent ranking: prefer lying flat (low layers), then
 *  shallow shelves, then narrow rows. Deterministic across equal volumes. */
function preferOption(a: OrientationOption, b: OrientationOption): boolean {
  if (a.extent[2] !== b.extent[2]) return a.extent[2] < b.extent[2]
  if (a.extent[1] !== b.extent[1]) return a.extent[1] < b.extent[1]
  return a.extent[0] < b.extent[0]
}

export const greedyShelfFit: FitStrategy = (boxes, carton, clearances, maxWeightG) => {
  const wall = clearances.wall
  const gap = clearances.betweenParts
  const usable: Vec3 = [carton[0] - 2 * wall, carton[1] - 2 * wall, carton[2] - 2 * wall]

  // Largest volume first; JS sort is stable, so equal volumes keep input order.
  // The product is taken over SORTED extents: a plain left-to-right product is
  // permutation-sensitive in the last ulp, which would let two same-dim parts
  // swap order just because their orientation lists start differently.
  const volumeOf = (b: PackBox): number => {
    if (b.orientations.length === 0) return 0
    const e = [...b.orientations[0].extent].sort((x, y) => x - y)
    return e[0] * e[1] * e[2]
  }
  const order = [...boxes].sort((a, b) => volumeOf(b) - volumeOf(a))

  let nextX = 0
  let yBase = 0
  let shelfDepth = 0
  let zBase = 0
  let layerHeight = 0
  let shelfEmpty = true
  let layerEmpty = true

  const findSpot = (box: PackBox): Spot | null => {
    const locations: Array<{ kind: Spot['kind']; x: number; y: number; z: number } | null> = [
      { kind: 'row', x: nextX, y: yBase, z: zBase },
      shelfEmpty ? null : { kind: 'new-shelf', x: 0, y: yBase + shelfDepth + gap, z: zBase },
      layerEmpty ? null : { kind: 'new-layer', x: 0, y: 0, z: zBase + layerHeight + gap }
    ]
    for (const loc of locations) {
      if (!loc) continue
      let best: OrientationOption | null = null
      for (const option of box.orientations) {
        const [ex, ey, ez] = option.extent
        if (
          fitsLe(loc.x + ex, usable[0]) &&
          fitsLe(loc.y + ey, usable[1]) &&
          fitsLe(loc.z + ez, usable[2])
        ) {
          if (!best || preferOption(option, best)) best = option
        }
      }
      if (best) return { ...loc, option: best }
    }
    return null
  }

  const placements: Placement[] = []
  const unplaced: string[] = []
  let totalWeightG = 0
  let placedVolume = 0
  let weightRejected = false
  let geometryRejected = false

  for (const box of order) {
    const spot = findSpot(box)
    if (!spot) {
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

    if (spot.kind === 'new-shelf') {
      yBase = spot.y
      shelfDepth = 0
      shelfEmpty = true
    } else if (spot.kind === 'new-layer') {
      zBase = spot.z
      layerHeight = 0
      yBase = 0
      shelfDepth = 0
      shelfEmpty = true
      layerEmpty = true
    }

    const [ex, ey, ez] = spot.option.extent
    const corner: Vec3 = [wall + spot.x, wall + spot.y, wall + spot.z]
    placements.push({
      partName: box.name,
      rotation: spot.option.rotation,
      translation: [
        corner[0] - spot.option.rotatedMin[0],
        corner[1] - spot.option.rotatedMin[1],
        corner[2] - spot.option.rotatedMin[2]
      ],
      boxMin: corner,
      boxMax: [corner[0] + ex, corner[1] + ey, corner[2] + ez]
    })
    nextX = spot.x + ex + gap
    shelfDepth = Math.max(shelfDepth, ey)
    layerHeight = Math.max(layerHeight, ez)
    shelfEmpty = false
    layerEmpty = false
    totalWeightG += box.weightG
    placedVolume += boxVolume(spot.option.extent)
  }

  // Binding attribution: a weight rejection means the cap actively curtailed the
  // packing, and it wins over geometry when both occurred (same convention as
  // the grid engine's tie → 'weight': it is the user-facing limit). With
  // everything placed, report the constraint with the LEAST headroom, so the
  // result still answers "what would bind first".
  let binding: BindingConstraint
  if (weightRejected) binding = 'weight'
  else if (geometryRejected) binding = 'geometry'
  else {
    const cartonVolume = boxVolume(carton)
    const weightFraction = maxWeightG > 0 ? totalWeightG / maxWeightG : 0
    const volumeFraction = cartonVolume > 0 ? placedVolume / cartonVolume : 0
    // weightFraction > 0 keeps the ≥ tie from calling a weightless (or empty)
    // packing 'weight'-bound — 0 ≥ 0 is a degenerate tie, not a constraint.
    binding = weightFraction > 0 && weightFraction >= volumeFraction ? 'weight' : 'geometry'
  }

  return { placements, unplaced, binding }
}
