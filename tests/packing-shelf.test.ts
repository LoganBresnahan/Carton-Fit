import { describe, expect, it } from 'vitest'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { EPS } from '../src/renderer/src/core/geometry'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  Placement,
  Vec3
} from '../src/renderer/src/core/packing/types'

// Hand-computed roster for the greedy shelf fit-check (plan adjudications: the
// verify targets are overlap-freedom and false non-fits). Orientation options
// are constructed directly — provider correctness is pinned in packing-fast.

const opt = (ex: number, ey: number, ez: number): OrientationOption => ({
  extent: [ex, ey, ez],
  rotation: IDENTITY_MAT3,
  rotatedMin: [0, 0, 0]
})

/** All distinct axis permutations of the dims, as orientation options. */
function perms(d: Vec3): OrientationOption[] {
  const seen = new Set<string>()
  const out: OrientationOption[] = []
  for (const p of [
    [d[0], d[1], d[2]],
    [d[0], d[2], d[1]],
    [d[1], d[0], d[2]],
    [d[1], d[2], d[0]],
    [d[2], d[0], d[1]],
    [d[2], d[1], d[0]]
  ]) {
    const key = p.join(',')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(opt(p[0], p[1], p[2]))
    }
  }
  return out
}

const box = (name: string, options: OrientationOption[], weightG = 0): PackBox => ({
  name,
  weightG,
  orientations: options
})

const NO_GAPS: Clearances = { betweenParts: 0, wall: 0 }

function strictOverlap(a: Placement, b: Placement): boolean {
  return [0, 1, 2].every(
    (i) => a.boxMin[i] < b.boxMax[i] - EPS && b.boxMin[i] < a.boxMax[i] - EPS
  )
}

function assertNoOverlaps(placements: Placement[]): void {
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      expect(strictOverlap(placements[i], placements[j])).toBe(false)
}

function assertInsideCarton(placements: Placement[], carton: Vec3, wall: number): void {
  for (const p of placements)
    for (let a = 0; a < 3; a++) {
      expect(p.boxMin[a]).toBeGreaterThanOrEqual(wall - EPS)
      expect(p.boxMax[a]).toBeLessThanOrEqual(carton[a] - wall + EPS)
    }
}

describe('greedyShelfFit', () => {
  it('places an exact-fit box (epsilon boundary), all-placed binding = geometry', () => {
    const r = greedyShelfFit([box('a', [opt(100, 100, 50)])], [100, 100, 50], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual([])
    expect(r.placements[0].boxMin).toEqual([0, 0, 0])
    expect(r.placements[0].boxMax).toEqual([100, 100, 50])
    expect(r.binding).toBe('geometry') // weightless: volume headroom is the tighter one
  })

  it('fits two boxes plus the between-parts gap exactly along a row', () => {
    const r = greedyShelfFit(
      [box('a', [opt(45, 100, 50)]), box('b', [opt(45, 100, 50)])],
      [100, 100, 50],
      { betweenParts: 10, wall: 0 },
      1e9
    )
    expect(r.unplaced).toEqual([])
    expect(r.placements.map((p) => p.boxMin[0])).toEqual([0, 55])
    assertNoOverlaps(r.placements)
  })

  it('wraps to a new shelf when the row is full', () => {
    const r = greedyShelfFit(
      [box('a', [opt(40, 40, 40)]), box('b', [opt(40, 40, 40)]), box('c', [opt(40, 40, 40)])],
      [100, 100, 50],
      NO_GAPS,
      1e9
    )
    expect(r.unplaced).toEqual([])
    expect(r.placements.map((p) => [p.boxMin[0], p.boxMin[1], p.boxMin[2]])).toEqual([
      [0, 0, 0],
      [40, 0, 0],
      [0, 40, 0] // 80+40 > 100 → next shelf
    ])
    assertNoOverlaps(r.placements)
  })

  it('wraps to a new layer when the shelf area is full, and rejects past the lid', () => {
    const boxes = ['a', 'b', 'c', 'd'].map((n) => box(n, [opt(50, 50, 30)]))
    const r = greedyShelfFit(boxes, [50, 50, 100], NO_GAPS, 1e9)
    expect(r.placements.map((p) => p.boxMin[2])).toEqual([0, 30, 60])
    expect(r.unplaced).toEqual(['d']) // 90 + 30 > 100
    expect(r.binding).toBe('geometry')
    assertNoOverlaps(r.placements)
  })

  it('places largest volume first regardless of input order', () => {
    const r = greedyShelfFit(
      [box('small', [opt(10, 10, 10)]), box('big', [opt(80, 80, 80)])],
      [100, 100, 100],
      NO_GAPS,
      1e9
    )
    expect(r.placements[0].partName).toBe('big')
    expect(r.placements[0].boxMin).toEqual([0, 0, 0])
    expect(r.placements[1].partName).toBe('small')
    assertNoOverlaps(r.placements)
  })

  it('re-orients a rod to avoid a false non-fit', () => {
    const r = greedyShelfFit([box('rod', perms([100, 10, 10]))], [10, 10, 100], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual([])
    expect(r.placements[0].boxMax).toEqual([10, 10, 100])
  })

  it('prefers lying flat: minimal z-extent, then y, then x', () => {
    const r = greedyShelfFit([box('a', perms([20, 10, 30]))], [100, 100, 100], NO_GAPS, 1e9)
    expect(r.placements[0].boxMax).toEqual([30, 20, 10])
  })

  it('applies the weight cap co-equally and keeps packing lighter parts after a rejection', () => {
    const boxes = [
      box('a', [opt(10, 10, 10)], 1000),
      box('b', [opt(10, 10, 10)], 1000),
      box('c', [opt(10, 10, 10)], 1000), // would exceed 2500
      box('d', [opt(10, 10, 10)], 400)
    ]
    const r = greedyShelfFit(boxes, [100, 100, 100], NO_GAPS, 2500)
    expect(r.unplaced).toEqual(['c'])
    expect(r.binding).toBe('weight')
    // The rejection must not consume space: d lands where c would have.
    expect(r.placements.map((p) => [p.partName, p.boxMin[0]])).toEqual([
      ['a', 0],
      ['b', 10],
      ['d', 20]
    ])
  })

  it('reports geometry when a part fits no orientation', () => {
    const r = greedyShelfFit(
      [box('long', perms([200, 10, 10]))],
      [100, 100, 100],
      NO_GAPS,
      1e9
    )
    expect(r.unplaced).toEqual(['long'])
    expect(r.binding).toBe('geometry')
  })

  it('weight takes precedence over geometry when both rejected (documented convention)', () => {
    const r = greedyShelfFit(
      [box('long', perms([200, 10, 10])), box('heavy', [opt(10, 10, 10)], 5000)],
      [100, 100, 100],
      NO_GAPS,
      1000
    )
    expect(r.unplaced.sort()).toEqual(['heavy', 'long'])
    expect(r.binding).toBe('weight')
  })

  it('honors the wall clearance on every face', () => {
    const fits = greedyShelfFit(
      [box('a', [opt(90, 90, 90)])],
      [100, 100, 100],
      { betweenParts: 0, wall: 5 },
      1e9
    )
    expect(fits.unplaced).toEqual([])
    expect(fits.placements[0].boxMin).toEqual([5, 5, 5])
    expect(fits.placements[0].boxMax).toEqual([95, 95, 95])

    const tooBig = greedyShelfFit(
      [box('a', perms([95, 10, 10]))],
      [100, 100, 100],
      { betweenParts: 0, wall: 5 },
      1e9
    )
    expect(tooBig.unplaced).toEqual(['a'])
  })

  it('reports the least-headroom constraint when everything fits (both ways, hand-computed)', () => {
    // weight 500/1000 = 0.5 vs volume 1000/1e6 = 0.001 → weight
    const w = greedyShelfFit([box('a', [opt(10, 10, 10)], 500)], [100, 100, 100], NO_GAPS, 1000)
    expect(w.unplaced).toEqual([])
    expect(w.binding).toBe('weight')
    // weight 10/1e6 vs volume 729000/1e6 = 0.729 → geometry
    const g = greedyShelfFit([box('a', [opt(90, 90, 90)], 10)], [100, 100, 100], NO_GAPS, 1e6)
    expect(g.unplaced).toEqual([])
    expect(g.binding).toBe('geometry')
  })

  it('never calls a weightless packing weight-bound (0 ≥ 0 degenerate tie)', () => {
    // Zero-volume placed set and empty input both used to hit 'weight' via 0 ≥ 0.
    const flat = greedyShelfFit([box('flat', [opt(10, 10, 0)])], [100, 100, 100], NO_GAPS, 1000)
    expect(flat.binding).toBe('geometry')
    const empty = greedyShelfFit([], [100, 100, 100], NO_GAPS, 1000)
    expect(empty.binding).toBe('geometry')
  })

  it('keeps input order for same-dim parts whose orientation lists start differently', () => {
    // A left-to-right extent product differs in the last ulp across permutations,
    // which used to reorder physically identical parts.
    const r = greedyShelfFit(
      [
        box('first', [opt(21.3, 55.7, 10.1)]),
        box('second', [opt(55.7, 10.1, 21.3)])
      ],
      [200, 200, 200],
      NO_GAPS,
      1e9
    )
    expect(r.placements.map((p) => p.partName)).toEqual(['first', 'second'])
  })

  it('stays overlap-free, in-carton, under-cap, and deterministic on a seeded mixed load', () => {
    let seed = 1234
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const dims = (): Vec3 => [5 + rnd() * 35, 5 + rnd() * 35, 5 + rnd() * 35]
    const boxes = Array.from({ length: 30 }, (_, i) => box(`p${i}`, perms(dims()), rnd() * 500))
    const carton: Vec3 = [120, 100, 80]
    const clearances: Clearances = { betweenParts: 2, wall: 3 }

    const r1 = greedyShelfFit(boxes, carton, clearances, 4000)
    const r2 = greedyShelfFit(boxes, carton, clearances, 4000)
    expect(r2).toEqual(r1) // deterministic

    assertNoOverlaps(r1.placements)
    assertInsideCarton(r1.placements, carton, clearances.wall)
    const placedNames = new Set(r1.placements.map((p) => p.partName))
    const totalWeight = boxes
      .filter((b) => placedNames.has(b.name))
      .reduce((s, b) => s + b.weightG, 0)
    expect(totalWeight).toBeLessThanOrEqual(4000 + EPS)
    expect(r1.placements.length + r1.unplaced.length).toBe(30)
  })
})
