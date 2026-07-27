import { describe, expect, it } from 'vitest'
import { extremePointFit } from '../src/renderer/src/core/packing/extremePointFit'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { EPS } from '../src/renderer/src/core/geometry'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  Placement,
  Vec3
} from '../src/renderer/src/core/packing/types'

// Hand-computed roster for the extreme-point fit-check (ADR-0022 phase 2). The
// phase-1 validator judges every arrangement here — the engine is the first
// placement code that CAN be geometrically wrong, so an independent checker
// guards it from the first unit test (build plan, slice `extreme-point-engine`).
// Orientation options are constructed directly, as in packing-shelf.

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

/** Independent judgment: the arrangement must be physically real, and honor the
 *  requested gaps when any were requested. */
function expectValid(placements: Placement[], carton: Vec3, clearances?: Clearances): void {
  expect(validatePlacements(placements, carton, { clearances })).toEqual([])
}

describe('extremePointFit', () => {
  it('places an exact-fit box (epsilon boundary), all-placed binding = geometry', () => {
    const r = extremePointFit([box('a', [opt(100, 100, 50)])], [100, 100, 50], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual([])
    expect(r.placements[0].boxMin).toEqual([0, 0, 0])
    expect(r.placements[0].boxMax).toEqual([100, 100, 50])
    expect(r.binding).toBe('geometry')
    expectValid(r.placements, [100, 100, 50])
  })

  it('spawns gap-offset points: two boxes plus the between-parts gap exactly fill a row', () => {
    const clearances: Clearances = { betweenParts: 10, wall: 0 }
    const r = extremePointFit(
      [box('a', [opt(45, 100, 50)]), box('b', [opt(45, 100, 50)])],
      [100, 100, 50],
      clearances,
      1e9
    )
    expect(r.unplaced).toEqual([])
    expect(r.placements.map((p) => p.boxMin[0])).toEqual([0, 55])
    expectValid(r.placements, [100, 100, 50], clearances)
  })

  it('honors the wall clearance on every face', () => {
    const clearances: Clearances = { betweenParts: 0, wall: 5 }
    const fits = extremePointFit([box('a', [opt(90, 90, 90)])], [100, 100, 100], clearances, 1e9)
    expect(fits.unplaced).toEqual([])
    expect(fits.placements[0].boxMin).toEqual([5, 5, 5])
    expect(fits.placements[0].boxMax).toEqual([95, 95, 95])
    expectValid(fits.placements, [100, 100, 100], clearances)

    const tooBig = extremePointFit([box('a', perms([95, 10, 10]))], [100, 100, 100], clearances, 1e9)
    expect(tooBig.unplaced).toEqual(['a'])
  })

  it('never double-counts wall and part gaps: wall-adjacent parts consume no trailing gap', () => {
    // Usable x window [5, 95]: 40 + 10 + 40 = 90 fits exactly; a wall+gap
    // double-count (5+40+10+40+10 = 105) would reject the second box.
    const clearances: Clearances = { betweenParts: 10, wall: 5 }
    const r = extremePointFit(
      [box('a', [opt(40, 90, 50)]), box('b', [opt(40, 90, 50)])],
      [100, 100, 60],
      clearances,
      1e9
    )
    expect(r.unplaced).toEqual([])
    expect(r.placements[0].boxMin).toEqual([5, 5, 5])
    expect(r.placements[0].boxMax).toEqual([45, 95, 55])
    expect(r.placements[1].boxMin).toEqual([55, 5, 5])
    expect(r.placements[1].boxMax).toEqual([95, 95, 55])
    expectValid(r.placements, [100, 100, 60], clearances)
  })

  it('recovers the space above a short part that shelf abandons (the ADR-0022 case)', () => {
    // Tower (60,50,50) + slab beside it growing the layer to 60 leaves a
    // 60×50×10 pocket above the tower. Shelf's layer cursor has moved past it
    // permanently; the point spawned on the tower's top face finds it.
    const boxes = [
      box('tower', perms([50, 50, 60])),
      box('slab', perms([40, 50, 60])),
      box('lid', perms([60, 50, 10]))
    ]
    const carton: Vec3 = [100, 50, 60]

    const shelf = greedyShelfFit(boxes, carton, NO_GAPS, 1e9)
    expect(shelf.unplaced).toEqual(['lid']) // the space exists, shelf cannot reach it

    const ep = extremePointFit(boxes, carton, NO_GAPS, 1e9)
    expect(ep.unplaced).toEqual([])
    expect(ep.placements.map((p) => [p.partName, ...p.boxMin])).toEqual([
      ['tower', 0, 0, 0],
      ['slab', 60, 0, 0],
      ['lid', 0, 0, 50]
    ])
    expect(ep.placements[2].boxMax).toEqual([60, 50, 60])
    expectValid(ep.placements, carton)
  })

  it('scoring switch changes the placement: deepest-bottom-left vs best-fit-volume', () => {
    // After the 60×60×20 slab, a 40-cube can go beside it (deepest point, but
    // envelope 100×60×40 = 240k) or on top (envelope 60×60×60 = 216k).
    const boxes = [box('slab', perms([60, 60, 20])), box('cube', [opt(40, 40, 40)])]
    const carton: Vec3 = [100, 100, 100]

    const dbl = extremePointFit(boxes, carton, NO_GAPS, 1e9, 'deepest-bottom-left')
    expect(dbl.placements[1].boxMin).toEqual([60, 0, 0])

    const bfv = extremePointFit(boxes, carton, NO_GAPS, 1e9, 'best-fit-volume')
    expect(bfv.placements[1].boxMin).toEqual([0, 0, 20])

    expectValid(dbl.placements, carton)
    expectValid(bfv.placements, carton)
  })

  it('re-orients a rod to avoid a false non-fit', () => {
    const r = extremePointFit([box('rod', perms([100, 10, 10]))], [10, 10, 100], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual([])
    expect(r.placements[0].boxMax).toEqual([10, 10, 100])
  })

  it('prefers lying flat among equal-score points: minimal z-extent, then y, then x', () => {
    const r = extremePointFit([box('a', perms([20, 10, 30]))], [100, 100, 100], NO_GAPS, 1e9)
    expect(r.placements[0].boxMax).toEqual([30, 20, 10])
  })

  it('applies the weight cap co-equally and keeps packing lighter parts after a rejection', () => {
    const boxes = [
      box('a', [opt(10, 10, 10)], 1000),
      box('b', [opt(10, 10, 10)], 1000),
      box('c', [opt(10, 10, 10)], 1000), // would exceed 2500
      box('d', [opt(10, 10, 10)], 400)
    ]
    const r = extremePointFit(boxes, [100, 100, 100], NO_GAPS, 2500)
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
    const r = extremePointFit([box('long', perms([200, 10, 10]))], [100, 100, 100], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual(['long'])
    expect(r.binding).toBe('geometry')
  })

  it('weight takes precedence over geometry when both rejected (documented convention)', () => {
    const r = extremePointFit(
      [box('long', perms([200, 10, 10])), box('heavy', [opt(10, 10, 10)], 5000)],
      [100, 100, 100],
      NO_GAPS,
      1000
    )
    expect(r.unplaced.sort()).toEqual(['heavy', 'long'])
    expect(r.binding).toBe('weight')
  })

  it('reports the least-headroom constraint when everything fits (both ways, hand-computed)', () => {
    // weight 500/1000 = 0.5 vs volume 1000/1e6 = 0.001 → weight
    const w = extremePointFit([box('a', [opt(10, 10, 10)], 500)], [100, 100, 100], NO_GAPS, 1000)
    expect(w.unplaced).toEqual([])
    expect(w.binding).toBe('weight')
    // weight 10/1e6 vs volume 729000/1e6 = 0.729 → geometry
    const g = extremePointFit([box('a', [opt(90, 90, 90)], 10)], [100, 100, 100], NO_GAPS, 1e6)
    expect(g.unplaced).toEqual([])
    expect(g.binding).toBe('geometry')
  })

  it('never calls a weightless packing weight-bound (0 ≥ 0 degenerate tie)', () => {
    const flat = extremePointFit([box('flat', [opt(10, 10, 0)])], [100, 100, 100], NO_GAPS, 1000)
    expect(flat.binding).toBe('geometry')
    const empty = extremePointFit([], [100, 100, 100], NO_GAPS, 1000)
    expect(empty.binding).toBe('geometry')
    expect(empty.placements).toEqual([])
    expect(empty.unplaced).toEqual([])
  })

  it('keeps input order for same-dim parts whose orientation lists start differently', () => {
    const r = extremePointFit(
      [box('first', [opt(21.3, 55.7, 10.1)]), box('second', [opt(55.7, 10.1, 21.3)])],
      [200, 200, 200],
      NO_GAPS,
      1e9
    )
    expect(r.placements.map((p) => p.partName)).toEqual(['first', 'second'])
  })

  it('rejects a box with no orientations as geometry, not a crash', () => {
    const r = extremePointFit([box('void', [])], [100, 100, 100], NO_GAPS, 1e9)
    expect(r.unplaced).toEqual(['void'])
    expect(r.binding).toBe('geometry')
  })

  it('lets a flat (zero-extent) part rest against a placed face — touching is not overlapping', () => {
    const r = extremePointFit(
      [box('cube', [opt(10, 10, 10)]), box('sheet', [opt(30, 20, 0)])],
      [50, 50, 50],
      NO_GAPS,
      1e9
    )
    expect(r.unplaced).toEqual([])
    // Cube first (volume order). The sheet keeps the deepest point (0,0,0): its
    // zero z-extent means it only TOUCHES the cube's bottom-face plane — zero
    // interpenetration, which phase 1 fixed as legal — so nothing forces it out.
    expect(r.placements.map((p) => [p.partName, ...p.boxMin])).toEqual([
      ['cube', 0, 0, 0],
      ['sheet', 0, 0, 0]
    ])
    expectValid(r.placements, [50, 50, 50])
  })

  it('packs touching neighbors at zero gap', () => {
    const r = extremePointFit(
      [box('a', [opt(50, 50, 50)]), box('b', [opt(50, 50, 50)])],
      [100, 50, 50],
      NO_GAPS,
      1e9
    )
    expect(r.unplaced).toEqual([])
    expect(r.placements.map((p) => p.boxMin[0])).toEqual([0, 50])
    expectValid(r.placements, [100, 50, 50])
  })

  // --- adversarial-verify regressions: each pins an executed refutation -----

  it('agrees with the validator at the containment boundary (subtraction-shape EPS)', () => {
    // extent = carton + EPS + rounding: the additive `a <= b + EPS` admitted
    // this when `7.07 + EPS` rounded up, and the validator then flagged
    // outside-carton — a crash-barrier discard. The engine must refuse it.
    const r = extremePointFit(
      [box('hair', [opt(7.07 + 1e-6, 1, 1)])],
      [7.07, 10, 10],
      NO_GAPS,
      1000
    )
    expect(r.unplaced).toEqual(['hair'])
    expect(r.binding).toBe('geometry')
  })

  it('clamps negative clearances to zero instead of packing parts into each other', () => {
    const boxes = [box('a', [opt(5, 5, 5)]), box('b', [opt(5, 5, 5)])]
    const r = extremePointFit(boxes, [50, 50, 50], { betweenParts: -3, wall: -4 }, 1000)
    expect(r.unplaced).toEqual([])
    // Degrades to "no gap": touching neighbors from the wall corner.
    expect(r.placements.map((p) => p.boxMin)).toEqual([
      [0, 0, 0],
      [5, 0, 0]
    ])
    expectValid(r.placements, [50, 50, 50])
  })

  it('rejects non-finite and negative extents as unplaceable, never as inverted boxes', () => {
    const r = extremePointFit(
      [
        box('minus-inf', [opt(5, -Infinity, 5)]),
        box('nan', [opt(NaN, 5, 5)]),
        box('negative', [opt(5, -2, 5)]),
        box('sane', [opt(5, 5, 5)])
      ],
      [60, 60, 60],
      NO_GAPS,
      1000
    )
    expect(r.placements.map((p) => p.partName)).toEqual(['sane'])
    expect(r.unplaced.sort()).toEqual(['minus-inf', 'nan', 'negative'])
    expectValid(r.placements, [60, 60, 60])
  })

  it('treats a NaN clearance as zero rather than letting it disable the overlap test', () => {
    const boxes = [box('a', [opt(5, 5, 5)]), box('b', [opt(5, 5, 5)])]
    const r = extremePointFit(boxes, [50, 50, 50], { betweenParts: NaN, wall: NaN }, 1000)
    expect(r.unplaced).toEqual([])
    expectValid(r.placements, [50, 50, 50])
  })

  it('breaks best-fit-volume envelope ties by orientation preference, not ulp noise', () => {
    // All orientations of a lone part produce the same envelope; a fixed-axis
    // product makes those "equal" volumes differ in the last ulp on non-dyadic
    // dims like 0.1/0.3/0.7, silently overriding the lying-flat fallback.
    const r = extremePointFit(
      [box('a', perms([0.1, 0.3, 0.7]))],
      [10, 10, 10],
      NO_GAPS,
      1e9,
      'best-fit-volume'
    )
    expect(r.placements[0].boxMax).toEqual([0.7, 0.3, 0.1])
  })

  it('stays valid, deterministic, under-cap, and ≥ shelf on a seeded mixed load (both rules)', () => {
    let seed = 1234
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const dims = (): Vec3 => [5 + rnd() * 35, 5 + rnd() * 35, 5 + rnd() * 35]
    const boxes = Array.from({ length: 30 }, (_, i) => box(`p${i}`, perms(dims()), rnd() * 500))
    const carton: Vec3 = [120, 100, 80]
    const clearances: Clearances = { betweenParts: 2, wall: 3 }

    const r1 = extremePointFit(boxes, carton, clearances, 4000)
    const r2 = extremePointFit(boxes, carton, clearances, 4000)
    expect(r2).toEqual(r1) // deterministic

    // The independent judge, at full strictness: physics AND clearances.
    expectValid(r1.placements, carton, clearances)

    const placedNames = new Set(r1.placements.map((p) => p.partName))
    const totalWeight = boxes
      .filter((b) => placedNames.has(b.name))
      .reduce((s, b) => s + b.weightG, 0)
    expect(totalWeight).toBeLessThanOrEqual(4000 + EPS)
    expect(r1.placements.length + r1.unplaced.length).toBe(30)

    // EP ≥ shelf holds on THIS input, but adversarial verify measured it false
    // in general (~0.3% of seeded inputs: dbl's depth-first choice can fragment
    // space a fresh shelf layer keeps whole). That is greedy variance, and the
    // incumbent race (ADR-0022 §2) is what absorbs it — the phase-3 fuzz must
    // assert its ≥ invariant against the RACED result, not raw EP.
    const shelf = greedyShelfFit(boxes, carton, clearances, 4000)
    expect(r1.placements.length).toBeGreaterThanOrEqual(shelf.placements.length)

    // The other scoring rule obeys the same contracts on the same load.
    const b1 = extremePointFit(boxes, carton, clearances, 4000, 'best-fit-volume')
    const b2 = extremePointFit(boxes, carton, clearances, 4000, 'best-fit-volume')
    expect(b2).toEqual(b1)
    expectValid(b1.placements, carton, clearances)
    expect(b1.placements.length + b1.unplaced.length).toBe(30)
  })
})
