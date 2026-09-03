import { describe, expect, it } from 'vitest'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { quantityUpperBound } from '../src/renderer/src/core/packing/quantityBound'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
import { pack } from '../src/renderer/src/core/packing/pack'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  PackPart,
  PackRequest,
  Vec3
} from '../src/renderer/src/core/packing/types'

// Hand-computed roster for the quantity upper bound (ADR-0022 phase 2). The ADR
// promises this number is RIGOROUS — the results line states it flatly — so the
// tests pin the two traps the build plan names (the clearance halo, and the
// per-axis-over-one-orientation lower bound in disguise) and the contradiction
// that must never ship: a bound below the achieved count.

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

const unit = (options: OrientationOption[], weightG = 0): PackBox => ({
  name: 'u',
  weightG,
  orientations: options
})

const NO_GAPS: Clearances = { betweenParts: 0, wall: 0 }

describe('quantityUpperBound', () => {
  it('is tight on an exact grid: 10-cubes in a 100-cube', () => {
    const u = unit([opt(10, 10, 10)])
    expect(quantityUpperBound(u, [100, 100, 100], NO_GAPS, Infinity)).toBe(1000)
    expect(gridFillQuantity(u, [100, 100, 100], NO_GAPS, Infinity).count).toBe(1000)
  })

  it('honors the clearance halo the way the grid does: n·e + (n−1)·gap per axis', () => {
    // floor((100+5)/(10+5)) = 7 per axis: wall-adjacent parts consume no
    // trailing gap, which is exactly the (usable+g)/(e+g) form.
    const u = unit([opt(10, 10, 10)])
    const clearances: Clearances = { betweenParts: 5, wall: 0 }
    expect(quantityUpperBound(u, [100, 100, 100], clearances, Infinity)).toBe(343)
    expect(gridFillQuantity(u, [100, 100, 100], clearances, Infinity).count).toBe(343)
  })

  it('shrinks the window by the wall clearance on every face', () => {
    const u = unit([opt(10, 10, 10)])
    const clearances: Clearances = { betweenParts: 0, wall: 5 }
    expect(quantityUpperBound(u, [110, 110, 110], clearances, Infinity)).toBe(1000)
  })

  it('dominates mixed orientations: 13 dominoes fit a 3-cube, not the grid\'s 9', () => {
    // The build plan's trap, pinned. A 1×1×2 domino grid packs 9 in a 3-cube
    // (single orientation), but 9 standing + 4 lying in the leftover slab is a
    // real arrangement of 13. A per-axis product over any ONE orientation
    // (3·3·1 = 9) would call the achievable 13 impossible. The rigorous bound
    // is the volumetric floor(27/2) = 13 — met exactly by that arrangement.
    const u = unit(perms([1, 1, 2]))
    expect(gridFillQuantity(u, [3, 3, 3], NO_GAPS, Infinity).count).toBe(9)
    expect(quantityUpperBound(u, [3, 3, 3], NO_GAPS, Infinity)).toBe(13)
  })

  it('takes the per-axis bound when it is the binding one', () => {
    // 7×7×7 cube in 10×10×30: volumetric floor(3000/343) = 8, but per-axis
    // 1·1·4 = 4 — the axis structure is the real constraint.
    const u = unit([opt(7, 7, 7)])
    expect(quantityUpperBound(u, [10, 10, 30], NO_GAPS, Infinity)).toBe(4)
  })

  it('includes the weight cap: arrangement cannot recover a weight-capped count', () => {
    const u = unit([opt(10, 10, 10)], 1000)
    expect(quantityUpperBound(u, [100, 100, 100], NO_GAPS, 5000)).toBe(5)
  })

  it('floors the weight ratio tolerantly (the 5 lb / 0.01 lb precedent)', () => {
    // The grams must come through the lb→g multiplication the app performs:
    // (5·453.59237)/(0.01·453.59237) = 499.99999999999994 in binary, and a
    // bare floor reports 499. (The pre-multiplied decimal literals divide to
    // exactly 500 and would let a bare floor pass.)
    const LB = 453.59237
    const u = unit([opt(1, 1, 1)], 0.01 * LB)
    expect(quantityUpperBound(u, [100, 100, 100], NO_GAPS, 5 * LB)).toBe(500)
  })

  it('uses the smallest inflated volume and per-axis minima across unequal options (thorough shape)', () => {
    // OBB option 8×10×10 (vol 800) beside AABB option 10×10×12 (vol 1200) in a
    // 20-cube: volumetric floor(8000/800) = 10; per-axis minima (8,10,10) give
    // 2·2·2 = 8 — the bound is their min, 8, and the grid achieves it.
    const u = unit([opt(8, 10, 10), opt(10, 10, 12)])
    expect(quantityUpperBound(u, [20, 20, 20], NO_GAPS, Infinity)).toBe(8)
    expect(gridFillQuantity(u, [20, 20, 20], NO_GAPS, Infinity).count).toBe(8)
  })

  it('returns Infinity only when no finite bound exists (weightless zero-extent unit)', () => {
    const flat = unit([opt(10, 10, 0)])
    expect(quantityUpperBound(flat, [100, 100, 100], NO_GAPS, Infinity)).toBe(Infinity)
    // The same unit with weight is capped by weight alone.
    const heavyFlat = unit([opt(10, 10, 0)], 100)
    expect(quantityUpperBound(heavyFlat, [100, 100, 100], NO_GAPS, 1000)).toBe(10)
    // And a zero-extent AXIS still leaves the other axes constraining nothing:
    // per-axis goes infinite on z but volumetric is 0-volume → Infinity there
    // too; only geometry on x/y could bind, and it does when the gap inflates
    // the halo.
    const gapped = quantityUpperBound(flat, [100, 100, 100], { betweenParts: 5, wall: 0 }, Infinity)
    // (105/15)² · (105/5) = 7 · 7 · 21 = 1029 — finite: the halo gives even a
    // zero-thickness sheet real volume.
    expect(gapped).toBe(1029)
  })

  it('returns 0 for a unit with no placeable orientation', () => {
    expect(quantityUpperBound(unit([]), [100, 100, 100], NO_GAPS, Infinity)).toBe(0)
    expect(
      quantityUpperBound(unit([opt(NaN, 5, 5), opt(5, -2, 5)]), [100, 100, 100], NO_GAPS, Infinity)
    ).toBe(0)
  })

  it('ignores garbage orientations beside sane ones', () => {
    const u = unit([opt(NaN, 5, 5), opt(10, 10, 10)])
    expect(quantityUpperBound(u, [100, 100, 100], NO_GAPS, Infinity)).toBe(1000)
  })

  it('returns 0 when the wall clearance leaves no window', () => {
    const u = unit([opt(10, 10, 10)])
    expect(quantityUpperBound(u, [100, 100, 100], { betweenParts: 0, wall: 60 }, Infinity)).toBe(0)
  })

  it('clamps negative and NaN clearances to zero, like the engines', () => {
    const u = unit([opt(10, 10, 10)])
    expect(quantityUpperBound(u, [100, 100, 100], { betweenParts: -3, wall: -4 }, Infinity)).toBe(1000)
    expect(quantityUpperBound(u, [100, 100, 100], { betweenParts: NaN, wall: NaN }, Infinity)).toBe(1000)
  })

  // --- adversarial-verify regressions: each pins an executed refutation -----

  it('dominates validator-accepted arrangements, not just ideal geometry (near-fit band)', () => {
    // Carton 5e-7 mm short of five exact cubes: the validator forgives up to
    // EPS = 1e-6 per face, so five cubes with the last overhanging by 5e-7 are
    // a VALID arrangement — and the ideal-geometry bound said 4. The judge's
    // tolerance is part of the model now.
    const u = unit([opt(10, 10, 10)])
    const carton: Vec3 = [50 - 5e-7, 10, 10]
    const five = Array.from({ length: 5 }, (_, i) => ({
      partName: 'u',
      rotation: IDENTITY_MAT3,
      translation: [i * 10, 0, 0] as Vec3,
      boxMin: [i * 10, 0, 0] as Vec3,
      boxMax: [i * 10 + 10, 10, 10] as Vec3
    }))
    expect(validatePlacements(five, carton)).toEqual([]) // the arrangement is real
    expect(quantityUpperBound(u, carton, NO_GAPS, Infinity)).toBeGreaterThanOrEqual(5)

    // The 1-vs-0 shape of the same refutation.
    expect(
      quantityUpperBound(u, [10 - 1e-7, 10, 10], NO_GAPS, Infinity)
    ).toBeGreaterThanOrEqual(1)
  })

  it('extends the same tolerance to the wall-clearance window', () => {
    // wall = 4 + 2.5e-7 leaves a 1.9999995 mm window for a 2 mm cube; the
    // validator accepts the EPS-overhung placement, so the bound must not say 0.
    const u = unit([opt(2, 2, 2)])
    expect(
      quantityUpperBound(u, [10, 10, 10], { betweenParts: 0, wall: 4 + 2.5e-7 }, Infinity)
    ).toBeGreaterThanOrEqual(1)
  })

  it('compounds the volumetric rescue nudge per axis, like the grid does', () => {
    // Each axis ratio a hair under an integer: the grid's per-axis tolerant
    // floors rescue all three, but a single-nudged volumetric floor lands at
    // count − 1. At 10 m scale the EPS window terms are relatively tiny, so
    // only the cubed nudge saves this one.
    const u = unit([opt(10000.000007, 10000.000007, 10000.000007)])
    const carton: Vec3 = [10000, 10000, 10000]
    const count = gridFillQuantity(u, carton, NO_GAPS, Infinity).count
    expect(count).toBe(1)
    expect(quantityUpperBound(u, carton, NO_GAPS, Infinity)).toBeGreaterThanOrEqual(count)
    // The pack()-reachable variant at ordinary scale: float32-clean part,
    // carton a hair under 100 per side — count 1000, single-nudge bound 999.
    const cube = unit([opt(10, 10, 10)])
    const shy: Vec3 = [99.99999994999999, 99.99999994999999, 99.99999994999999]
    const shyCount = gridFillQuantity(cube, shy, NO_GAPS, Infinity).count
    expect(shyCount).toBe(1000)
    expect(quantityUpperBound(cube, shy, NO_GAPS, Infinity)).toBeGreaterThanOrEqual(shyCount)
  })

  it('honors the gap inside the per-axis cells when per-axis is the binding component', () => {
    // 7-cube, gap 2, carton 10×10×30: per axis floor(12/9)=1, 1, floor(32/9)=3
    // → 3; volumetric floor(4608/729) = 6. The bound is 3, and the grid
    // achieves it — a gap dropped from the cell arithmetic would report 4.
    const u = unit([opt(7, 7, 7)])
    const clearances: Clearances = { betweenParts: 2, wall: 0 }
    expect(gridFillQuantity(u, [10, 10, 30], clearances, Infinity).count).toBe(3)
    expect(quantityUpperBound(u, [10, 10, 30], clearances, Infinity)).toBe(3)
  })

  it('never falls below the grid count on a seeded sweep (the visible contradiction)', () => {
    let seed = 987654321
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    for (let i = 0; i < 400; i++) {
      const dims: Vec3 = [0.5 + rnd() * 40, 0.5 + rnd() * 40, 0.5 + rnd() * 40]
      const u = unit(perms(dims), rnd() < 0.3 ? rnd() * 200 : 0)
      const carton: Vec3 = [20 + rnd() * 180, 20 + rnd() * 180, 20 + rnd() * 180]
      const clearances: Clearances = {
        betweenParts: rnd() < 0.5 ? rnd() * 6 : 0,
        wall: rnd() < 0.5 ? rnd() * 6 : 0
      }
      const maxWeightG = rnd() < 0.3 ? rnd() * 20_000 : Infinity
      const count = gridFillQuantity(u, carton, clearances, maxWeightG).count
      const bound = quantityUpperBound(u, carton, clearances, maxWeightG)
      expect(bound, `case ${i}: bound ${bound} < count ${count}`).toBeGreaterThanOrEqual(count)
    }
  })
})

describe('pack — upperBound field', () => {
  function cubePart(name: string, size: Vec3, weightG = 0): PackPart {
    const pts: number[][] = []
    for (const x of [0, size[0]])
      for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
    const positions = new Float32Array(pts.length * 3)
    pts.forEach((p, i) => positions.set(p, i * 3))
    return { name, positions, weightG }
  }
  const req = (parts: PackPart[], carton: Vec3, maxWeightG = Infinity): PackRequest => ({
    mode: 'max-quantity',
    tier: 'fast',
    carton,
    clearances: NO_GAPS,
    maxWeightG,
    parts
  })

  it('carries a rigorous upperBound ≥ count on an ordinary request', () => {
    const r = pack(req([cubePart('u', [10, 10, 10])], [100, 100, 100]))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.count).toBe(1000)
    expect(r.upperBound).toBe(1000)
  })

  it('the gap the bound exposed is now closed by refinement (ADR-0022 §4)', () => {
    // When this test was written the grid answered 9 against a bound of 13 and
    // the assertion showed the honest gap. Phase 4's EP refinement closes it:
    // the orchestrator now achieves the bound, and the honest-gap behaviour
    // lives where the gap still exists — between the raw grid and the bound.
    const r = pack(req([cubePart('domino', [1, 1, 2])], [3, 3, 3]))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.count).toBe(13)
    expect(r.upperBound).toBe(13)
  })

  it('omits the field when no finite bound exists, and on the empty request', () => {
    const flat = pack(req([cubePart('sheet', [10, 10, 0])], [100, 100, 100]))
    if (flat.mode !== 'max-quantity') throw new Error('mode')
    expect(flat.upperBound).toBeUndefined()
    expect('upperBound' in flat).toBe(false) // absent, not undefined-valued (JSON shape)
    const empty = pack(req([], [100, 100, 100]))
    if (empty.mode !== 'max-quantity') throw new Error('mode')
    expect(empty.upperBound).toBeUndefined()
  })

  it('reflects the weight cap in both count and bound', () => {
    const r = pack(req([cubePart('u', [10, 10, 10], 1000)], [100, 100, 100], 5000))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.count).toBe(5)
    expect(r.upperBound).toBe(5)
  })

  // ADR-0029 phase-2 amendment 2: the geometry-only bound exists to be EVIDENCE
  // about the carton, which the whole bound cannot be — on a weight-capped run
  // `upperBound === count` always, no matter how empty the box. A dogfooding AI
  // read that equality as "the carton is full too"; these pin the number that
  // actually answers it.
  it('keeps the weight cap out of the geometry-only bound', () => {
    // Five 1 kg cubes under a 5 kg cap, in a carton with room for a thousand.
    const r = pack(req([cubePart('u', [10, 10, 10], 1000)], [100, 100, 100], 5000))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.upperBound).toBe(5)
    // The whole point: this number did not move when the cap did.
    expect(r.geometryBound).toBe(1000)
  })

  it('lands on the count when the carton really is out of room too', () => {
    // 10-cubes in a 25-cube: 2 per axis = 8 by geometry. A cap of exactly 8 kg
    // ties the two limits, which the engine labels 'weight' by convention —
    // and only the geometry bound can show that the carton is finished as well.
    const r = pack(req([cubePart('u', [10, 10, 10], 1000)], [25, 25, 25], 8000))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.count).toBe(8)
    expect(r.binding).toBe('weight')
    expect(r.geometryBound).toBe(8)
  })

  // ADR-0033: the lifted-cap rerun, computed only where the question exists.
  it('packs again with the cap lifted when weight bound an unsettled count', () => {
    // Five 1 kg cubes under a 5 kg cap; the carton takes a thousand. The bound
    // (1000) cannot prove room; the rerun places it.
    const r = pack(req([cubePart('u', [10, 10, 10], 1000)], [100, 100, 100], 5000))
    if (r.mode !== 'max-quantity') throw new Error('mode')
    expect(r.binding).toBe('weight')
    expect(r.spaceOnlyCount).toBe(1000)
  })

  it('does not rerun when the bound already settled it, or when space bound the count', () => {
    // Tie: 8 by geometry, 8 by weight — the rigorous bound proves it, no search.
    const tie = pack(req([cubePart('u', [10, 10, 10], 1000)], [25, 25, 25], 8000))
    if (tie.mode !== 'max-quantity') throw new Error('mode')
    expect(tie.geometryBound).toBe(8)
    expect('spaceOnlyCount' in tie).toBe(false)
    // Geometry-bound: the cap was never the limit, so lifting it is no question.
    const roomy = pack(req([cubePart('u', [10, 10, 10], 1)], [25, 25, 25], 1_000_000))
    if (roomy.mode !== 'max-quantity') throw new Error('mode')
    expect(roomy.binding).toBe('geometry')
    expect('spaceOnlyCount' in roomy).toBe(false)
  })

  it('is absent exactly when no finite geometric bound exists', () => {
    const flat = pack(req([cubePart('sheet', [10, 10, 0])], [100, 100, 100]))
    if (flat.mode !== 'max-quantity') throw new Error('mode')
    expect('geometryBound' in flat).toBe(false)
    // A weight cap does not conjure one: the carton still bounds nothing.
    const capped = pack(req([cubePart('sheet', [10, 10, 0], 1000)], [100, 100, 100], 5000))
    if (capped.mode !== 'max-quantity') throw new Error('mode')
    expect(capped.upperBound).toBe(5)
    expect('geometryBound' in capped).toBe(false)
  })
})
