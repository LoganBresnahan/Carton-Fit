import { describe, expect, it } from 'vitest'
import { aabbOrientations, det3 } from '../src/renderer/src/core/packing/orientations'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
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
