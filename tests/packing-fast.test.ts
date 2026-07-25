import { describe, expect, it } from 'vitest'
import { MAX_GRID_PLACEMENTS } from '../src/renderer/src/core/packing/quantityGrid'
import { aabbOrientations, det3 } from '../src/renderer/src/core/packing/orientations'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
import { inToMm, lbToG } from '../src/renderer/src/core/units'
import type { Clearances, PackBox, PackPart, Vec3 } from '../src/renderer/src/core/packing/types'

const NO_CLEARANCE: Clearances = { betweenParts: 0, wall: 0 }

/** An axis-aligned box part [0..sx, 0..sy, 0..sz], as two triangles per face isn't
 *  needed — packing only reads the AABB, so 2 corner vertices pin it. */
function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
  return {
    name,
    positions: new Float32Array([0, 0, 0, size[0], size[1], size[2]]),
    weightG
  }
}

function unit(name: string, size: Vec3, weightG = 0): PackBox {
  return { name, weightG, orientations: aabbOrientations(boxPart(name, size, weightG)) }
}

describe('aabbOrientations', () => {
  it('produces 6 orientations, all proper rotations (det +1, no mirroring)', () => {
    const opts = aabbOrientations(boxPart('p', [2, 3, 4]))
    expect(opts).toHaveLength(6)
    for (const o of opts) expect(det3(o.rotation)).toBeCloseTo(1, 9)
  })

  it('yields exactly the 6 extent permutations of the AABB', () => {
    const opts = aabbOrientations(boxPart('p', [2, 3, 4]))
    const extents = opts.map((o) => o.extent.join(',')).sort()
    expect(extents).toEqual(
      ['2,3,4', '2,4,3', '3,2,4', '3,4,2', '4,2,3', '4,3,2'].sort()
    )
  })

  it('reports the rotated AABB min so placement can translate to a corner', () => {
    // part occupying [0..2,0..3,0..4]; every orientation's rotatedMin + extent must
    // re-span the same rotated box (checked indirectly: min ≤ min+extent).
    for (const o of aabbOrientations(boxPart('p', [2, 3, 4]))) {
      expect(o.rotatedMin.length).toBe(3)
      expect(o.extent.every((e) => e > 0)).toBe(true)
    }
  })
})

describe('gridFillQuantity — counts', () => {
  it('exact fit: 100 / 10 = 10 per axis, no remainder', () => {
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [100, 100, 100], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(1000) // 10 × 10 × 10
    expect(r.binding).toBe('geometry')
  })

  it('off-by-one: 105 / 10 = 10 (not 10.5), remainder wasted', () => {
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [105, 100, 100], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(1000) // floor(105/10)=10 along x
  })

  it('between-parts gap uses the (usable+gap)/(dim+gap) formula', () => {
    // usable 100, part 10, gap 5 → floor((100+5)/(10+5)) = floor(7) = 7 along each axis
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [100, 100, 100], { betweenParts: 5, wall: 0 }, Infinity)
    expect(r.count).toBe(343) // 7³
  })

  it('wall clearance shrinks the usable interior by 2× on each axis', () => {
    // carton 100, wall 5 → usable 90; part 10, no gap → 9 per axis
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [100, 100, 100], { betweenParts: 0, wall: 5 }, Infinity)
    expect(r.count).toBe(729) // 9³
  })

  it('part larger than carton in every orientation → 0, geometry-bound', () => {
    const r = gridFillQuantity(unit('u', [200, 200, 200]), [100, 100, 100], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(0)
    expect(r.binding).toBe('geometry')
  })

  it('clearance ≥ part dim still fits one where the box itself fits', () => {
    // usable 100, part 10, gap 200 → floor((100+200)/(10+200)) = floor(1.43) = 1
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [100, 100, 100], { betweenParts: 200, wall: 0 }, Infinity)
    expect(r.count).toBe(1)
  })

  it('picks the orientation that fits the most (rod stands up)', () => {
    // a 5×5×90 rod in a 100×100×100 box: lying flat packs poorly; upright packs 19×19×1
    const r = gridFillQuantity(unit('rod', [90, 5, 5]), [100, 100, 100], NO_CLEARANCE, Infinity)
    // best orientation: 90 along one axis (1), 5×5 across the 100×100 face (20×20) = 400
    expect(r.count).toBe(400)
  })
})

describe('gridFillQuantity — float-exact limits', () => {
  it('counts 500, not 499, for a 5 lb cap and 0.01 lb parts (unit-conversion floor)', () => {
    // Exactly 500 in decimal; in canonical grams the ratio lands a hair under
    // 500 in binary, and a bare Math.floor silently reported 499. Found by
    // dogfooding the real UI, which is why it is pinned here.
    const cap = lbToG(5)
    const each = lbToG(0.01)
    const r = gridFillQuantity(unit('u', [1, 1, 1], each), [1000, 1000, 1000], NO_CLEARANCE, cap)
    expect(r.count).toBe(500)
    expect(r.binding).toBe('weight')
  })

  it('still floors a genuine fraction', () => {
    const r = gridFillQuantity(unit('u', [1, 1, 1], 3), [1000, 1000, 1000], NO_CLEARANCE, 10)
    expect(r.count).toBe(3) // 10/3 = 3.33 → 3, not rescued to 4
  })

  it('counts an inch-derived exact fit without losing a row', () => {
    // 12 in carton, 1 in part: exactly 12 per axis once converted to mm.
    const r = gridFillQuantity(
      unit('u', [inToMm(1), inToMm(1), inToMm(1)]),
      [inToMm(12), inToMm(12), inToMm(12)],
      NO_CLEARANCE,
      Infinity
    )
    expect(r.count).toBe(12 * 12 * 12)
  })
})

describe('gridFillQuantity — materialization cap', () => {
  it('reports the true count but materializes at most MAX_GRID_PLACEMENTS', () => {
    // A weightless 1 mm part in a 600 mm carton counts 2.16e8 copies — building
    // an object per copy OOMed the process (thorough-tier verify finding).
    const r = gridFillQuantity(unit('tiny', [1, 1, 1]), [600, 600, 600], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(600 * 600 * 600)
    expect(r.placements.length).toBe(MAX_GRID_PLACEMENTS)
    expect(r.binding).toBe('geometry')
  })

  it('treats sub-EPS extents as unpackable (degenerate, not near-infinite)', () => {
    const flat: PackBox = {
      name: 'flat',
      weightG: 0,
      orientations: [
        { extent: [10, 10, 1e-7], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], rotatedMin: [0, 0, 0] }
      ]
    }
    const r = gridFillQuantity(flat, [100, 100, 100], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(0)
    expect(r.binding).toBe('geometry')
  })
})

describe('gridFillQuantity — weight cap + binding constraint', () => {
  it('weight caps the count below geometric capacity → weight-bound', () => {
    // geometry allows 1000; each unit 100 g, max 5000 g → 50 by weight
    const r = gridFillQuantity(unit('u', [10, 10, 10], 100), [100, 100, 100], NO_CLEARANCE, 5000)
    expect(r.count).toBe(50)
    expect(r.binding).toBe('weight')
    expect(r.placements).toHaveLength(50)
  })

  it('geometry binds when it is the smaller cap', () => {
    // geometry 1000; weight allows floor(1e6/100)=10000 → geometry binds
    const r = gridFillQuantity(unit('u', [10, 10, 10], 100), [100, 100, 100], NO_CLEARANCE, 1_000_000)
    expect(r.count).toBe(1000)
    expect(r.binding).toBe('geometry')
  })

  it('a weightless part is never weight-bound', () => {
    const r = gridFillQuantity(unit('u', [10, 10, 10], 0), [100, 100, 100], NO_CLEARANCE, 1)
    expect(r.count).toBe(1000)
    expect(r.binding).toBe('geometry')
  })

  it('places non-overlapping boxes inside the carton', () => {
    const r = gridFillQuantity(unit('u', [10, 10, 10]), [30, 10, 10], NO_CLEARANCE, Infinity)
    expect(r.count).toBe(3)
    const xs = r.placements.map((p) => p.boxMin[0]).sort((a, b) => a - b)
    expect(xs).toEqual([0, 10, 20])
    for (const p of r.placements) {
      expect(p.boxMax[0]).toBeLessThanOrEqual(30)
      expect(p.boxMin[0]).toBeGreaterThanOrEqual(0)
    }
  })
})
