import { describe, expect, it } from 'vitest'
import {
  isPhysicallyImpossible,
  validatePlacements
} from '../src/renderer/src/core/packing/validate'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
import { EPS } from '../src/renderer/src/core/geometry'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  Placement,
  Vec3
} from '../src/renderer/src/core/packing/types'

// The independent validator (ADR-0022 phase 1). Two things are being pinned: the
// semantics the module doc fixes (touching passes, clearance shortfalls are graded
// apart from physical impossibility), and — the load-bearing half — that the
// validator AGREES with the two engines that are overlap-free by construction. If
// it flagged shelf or grid output, it would be useless as a crash barrier, because
// every EP result would look broken too.

const box = (name: string, min: Vec3, max: Vec3): Placement => ({
  partName: name,
  rotation: IDENTITY_MAT3,
  translation: [0, 0, 0],
  boxMin: min,
  boxMax: max
})

const packBox = (name: string, d: Vec3, weightG = 0): PackBox => ({
  name,
  weightG,
  orientations: [{ extent: d, rotation: IDENTITY_MAT3, rotatedMin: [0, 0, 0] } as OrientationOption]
})

const NO_CLEARANCE: Clearances = { betweenParts: 0, wall: 0 }
const CARTON: Vec3 = [100, 100, 100]

describe('validatePlacements — physical reality', () => {
  it('accepts boxes that share a face exactly (decision 1: touching is not overlapping)', () => {
    const placements = [
      box('a', [0, 0, 0], [50, 100, 100]),
      box('b', [50, 0, 0], [100, 100, 100])
    ]
    expect(validatePlacements(placements, CARTON)).toEqual([])
  })

  it('reports interpenetration with its depth and both indices', () => {
    const placements = [
      box('a', [0, 0, 0], [60, 100, 100]),
      box('b', [50, 0, 0], [100, 100, 100])
    ]
    const [v, ...rest] = validatePlacements(placements, CARTON)
    expect(rest).toEqual([])
    expect(v.kind).toBe('overlap')
    expect(v.indexA).toBe(0)
    expect(v.indexB).toBe(1)
    expect(v.shortfallMm).toBeCloseTo(10, 9)
    expect(v.detail).toContain('a')
    expect(v.detail).toContain('b')
  })

  it('forgives sub-tolerance interpenetration and catches it just over the line', () => {
    const under = [box('a', [0, 0, 0], [50 + EPS / 2, 10, 10]), box('b', [50, 0, 0], [60, 10, 10])]
    expect(validatePlacements(under, CARTON)).toEqual([])

    const over = [box('a', [0, 0, 0], [50 + EPS * 10, 10, 10]), box('b', [50, 0, 0], [60, 10, 10])]
    expect(validatePlacements(over, CARTON).map((v) => v.kind)).toEqual(['overlap'])
  })

  it('only counts an overlap when the boxes overlap on ALL three axes', () => {
    // Deeply overlapping in x and y, disjoint in z — a stack, not a collision.
    const placements = [box('a', [0, 0, 0], [50, 50, 10]), box('b', [0, 0, 10], [50, 50, 20])]
    expect(validatePlacements(placements, CARTON)).toEqual([])
  })

  it('flags a part that escapes the carton, and measures the escape', () => {
    const placements = [box('a', [0, 0, 0], [110, 10, 10])]
    const [v] = validatePlacements(placements, CARTON)
    expect(v.kind).toBe('outside-carton')
    expect(v.indexA).toBe(0)
    expect(v.shortfallMm).toBeCloseTo(10, 9)
  })

  it('flags a part with a negative coordinate as escaping', () => {
    const placements = [box('a', [-5, 0, 0], [10, 10, 10])]
    expect(validatePlacements(placements, CARTON).map((v) => v.kind)).toEqual(['outside-carton'])
  })

  it('flags non-finite and inverted boxes without trying to reason about them', () => {
    const placements = [
      box('nan', [0, 0, 0], [NaN, 10, 10]),
      box('inverted', [50, 0, 0], [40, 10, 10]),
      box('fine', [0, 20, 0], [10, 30, 10])
    ]
    const kinds = validatePlacements(placements, CARTON).map((v) => `${v.kind}:${v.indexA}`)
    expect(kinds).toEqual(['degenerate-box:0', 'degenerate-box:1'])
  })

  it('does not flag a zero-extent box — a flat part in an axis plane is legal', () => {
    const placements = [box('sheet', [0, 0, 0], [50, 50, 0])]
    expect(validatePlacements(placements, CARTON)).toEqual([])
  })
})

describe('validatePlacements — clearances, graded apart from physics', () => {
  const clearances: Clearances = { betweenParts: 5, wall: 3 }

  it('reports a gap that falls short of the requested part-to-part clearance', () => {
    const placements = [box('a', [3, 3, 3], [20, 20, 20]), box('b', [22, 3, 3], [40, 20, 20])]
    const [v, ...rest] = validatePlacements(placements, CARTON, { clearances })
    expect(rest).toEqual([])
    expect(v.kind).toBe('clearance-parts')
    expect(v.shortfallMm).toBeCloseTo(3, 9) // 2 mm apart, 5 mm asked for
    expect(isPhysicallyImpossible(v)).toBe(false)
  })

  it('accepts a gap of exactly the requested clearance', () => {
    const placements = [box('a', [3, 3, 3], [20, 20, 20]), box('b', [25, 3, 3], [40, 20, 20])]
    expect(validatePlacements(placements, CARTON, { clearances })).toEqual([])
  })

  it('reports a part inside the carton but too close to a wall', () => {
    const placements = [box('a', [1, 3, 3], [20, 20, 20])]
    const [v] = validatePlacements(placements, CARTON, { clearances })
    expect(v.kind).toBe('clearance-wall')
    expect(v.shortfallMm).toBeCloseTo(2, 9)
    expect(isPhysicallyImpossible(v)).toBe(false)
  })

  it('ignores clearance shortfalls entirely when no clearances are passed', () => {
    const tight = [box('a', [0, 0, 0], [20, 20, 20]), box('b', [20, 0, 0], [40, 20, 20])]
    expect(validatePlacements(tight, CARTON)).toEqual([])
    expect(validatePlacements(tight, CARTON, { clearances }).map((v) => v.kind)).toEqual([
      'clearance-wall',
      'clearance-wall',
      'clearance-parts'
    ])
  })

  it('calls interpenetration impossible and a short gap not, so the barrier can split them', () => {
    const placements = [
      box('a', [3, 3, 3], [30, 20, 20]),
      box('b', [25, 3, 3], [45, 20, 20]), // overlaps a
      box('c', [48, 3, 3], [60, 20, 20]) // 3 mm from b, short of 5
    ]
    const found = validatePlacements(placements, CARTON, { clearances })
    expect(found.map((v) => v.kind)).toEqual(['overlap', 'clearance-parts'])
    expect(found.filter(isPhysicallyImpossible).map((v) => v.kind)).toEqual(['overlap'])
  })
})

describe('validatePlacements — agreement with the by-construction-correct engines', () => {
  // The positive control. Shelf and grid contain no collision test at all; their
  // disjointness falls out of cursor and index arithmetic. A validator that
  // disagreed with them would be worthless as a judge of the EP engine.
  // Dimensions divide exactly, to stay off quantityGrid's tolerant-floor path.

  it('passes a greedy shelf packing, with its clearances honored', () => {
    const clearances: Clearances = { betweenParts: 5, wall: 10 }
    const boxes = [
      packBox('big', [80, 60, 40]),
      packBox('mid', [50, 40, 30]),
      packBox('small', [20, 20, 20]),
      packBox('flat', [70, 10, 10]),
      packBox('tall', [15, 15, 90])
    ]
    const carton: Vec3 = [300, 250, 200]
    const fit = greedyShelfFit(boxes, carton, clearances, Number.POSITIVE_INFINITY)
    expect(fit.placements.length).toBeGreaterThan(1)
    expect(validatePlacements(fit.placements, carton, { clearances })).toEqual([])
  })

  it('passes a grid quantity fill, with its clearances honored', () => {
    const clearances: Clearances = { betweenParts: 10, wall: 20 }
    const carton: Vec3 = [300, 300, 300]
    const quantity = gridFillQuantity(
      packBox('unit', [30, 30, 30]),
      carton,
      clearances,
      Number.POSITIVE_INFINITY
    )
    expect(quantity.count).toBeGreaterThan(10)
    expect(validatePlacements(quantity.placements, carton, { clearances })).toEqual([])
  })

  it('passes a zero-clearance grid, where every neighbour shares a face', () => {
    const carton: Vec3 = [300, 300, 300]
    const quantity = gridFillQuantity(
      packBox('unit', [30, 30, 30]),
      carton,
      NO_CLEARANCE,
      Number.POSITIVE_INFINITY
    )
    expect(quantity.count).toBe(1000)
    expect(validatePlacements(quantity.placements, carton, { clearances: NO_CLEARANCE })).toEqual([])
  })
})

describe('validatePlacements — the sweep must not miss pairs', () => {
  // The early exit is the one place a wrong optimization hides a real overlap: it
  // is only sound because the sweep is sorted by box min on the swept axis.

  it('finds an overlap between placements that are far apart in the ARRAY', () => {
    const placements: Placement[] = []
    for (let i = 0; i < 200; i++) {
      placements.push(box(`p${i}`, [i * 10, 0, 0], [i * 10 + 10, 10, 10]))
    }
    placements.push(box('stowaway', [5, 0, 0], [15, 10, 10])) // overlaps p0 and p1
    const found = validatePlacements(placements, [3000, 100, 100])
    expect(found.map((v) => v.kind)).toEqual(['overlap', 'overlap'])
    expect(found.map((v) => v.indexB)).toEqual([200, 200])
    expect(found.map((v) => v.indexA)).toEqual([0, 1])
  })

  it('finds an overlap at the far end of the swept axis', () => {
    const placements: Placement[] = []
    for (let i = 0; i < 200; i++) {
      placements.push(box(`p${i}`, [i * 10, 0, 0], [i * 10 + 10, 10, 10]))
    }
    placements[199] = box('p199', [1985, 0, 0], [2000, 10, 10]) // now overlaps p198
    const found = validatePlacements(placements, [3000, 100, 100])
    expect(found.map((v) => `${v.kind}:${v.indexA}-${v.indexB}`)).toEqual(['overlap:198-199'])
  })

  it('finds an overlap with a long box that spans much of the sweep', () => {
    const placements = [
      box('rail', [0, 0, 0], [200, 5, 5]),
      box('a', [0, 20, 0], [10, 30, 10]),
      box('clash', [190, 2, 0], [200, 8, 5])
    ]
    const found = validatePlacements(placements, [300, 100, 100])
    expect(found.map((v) => `${v.kind}:${v.indexA}-${v.indexB}`)).toEqual(['overlap:0-2'])
  })
})

describe('validatePlacements — reporting contract', () => {
  it('stops early at the limit, which is all the crash barrier needs', () => {
    const placements = [
      box('a', [0, 0, 0], [50, 50, 50]),
      box('b', [10, 10, 10], [60, 60, 60]),
      box('c', [20, 20, 20], [70, 70, 70])
    ]
    expect(validatePlacements(placements, CARTON)).toHaveLength(3)
    expect(validatePlacements(placements, CARTON, { limit: 1 })).toHaveLength(1)
  })

  it('is deterministic and orders violations by index', () => {
    const placements = [
      box('a', [0, 0, 0], [50, 50, 50]),
      box('b', [200, 0, 0], [210, 10, 10]), // outside the carton
      box('c', [10, 10, 10], [60, 60, 60]) // overlaps a
    ]
    const first = validatePlacements(placements, CARTON)
    const second = validatePlacements(placements, CARTON)
    expect(second).toEqual(first)
    expect(first.map((v) => `${v.kind}:${v.indexA}`)).toEqual(['outside-carton:1', 'overlap:0'])
  })

  it('accepts an empty arrangement', () => {
    expect(validatePlacements([], CARTON, { clearances: { betweenParts: 5, wall: 5 } })).toEqual([])
  })
})
