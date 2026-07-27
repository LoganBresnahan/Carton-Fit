import { describe, expect, it } from 'vitest'
import {
  MAX_REFINE_COPIES,
  refineQuantity
} from '../src/renderer/src/core/packing/quantityRefine'
import { gridFillQuantity } from '../src/renderer/src/core/packing/quantityGrid'
import { quantityUpperBound } from '../src/renderer/src/core/packing/quantityBound'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
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

// quantity-mode-ep-refinement (ADR-0022 §4). The contract under test is the
// RATCHET: the orchestrator's answer is max(grid, EP) by construction, because
// refineQuantity returns non-null only on a strict improvement — so the worst
// case is exactly the instant grid answer, and a floor violation (a refined
// count below the grid's) is structurally impossible rather than merely tested
// against. The headline case is the domino family the upper-bound slice
// already pins: the grid packs 9 in a 3-cube, the rigorous bound says 13, and
// EP's mixed orientations achieve exactly 13 — the number the bound slice
// proved was being called impossible by every single-orientation argument.

const NO_GAPS: Clearances = { betweenParts: 0, wall: 0 }

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

const DOMINO = (): PackBox => unit(perms([1, 1, 2]))
const CUBE3: Vec3 = [3, 3, 3]

describe('refineQuantity — the wins', () => {
  it('dominoes in a 3-cube: 9 → 13, the perfect packing the bound promised', () => {
    const u = DOMINO()
    const grid = gridFillQuantity(u, CUBE3, NO_GAPS, Infinity)
    const bound = quantityUpperBound(u, CUBE3, NO_GAPS, Infinity)
    expect(grid.count).toBe(9)
    expect(bound).toBe(13)

    const r = refineQuantity(u, CUBE3, NO_GAPS, Infinity, grid.count, bound)
    expect(r).not.toBeNull()
    expect(r!.count).toBe(13)
    expect(r!.placements).toHaveLength(13)
    // Weight never entered; geometry (a full carton) is what stops a 14th.
    expect(r!.binding).toBe('geometry')
    // The arrangement is real: the independent judge accepts every placement.
    expect(validatePlacements(r!.placements, CUBE3, { clearances: NO_GAPS })).toEqual([])
  })

  it('2×3×5 bricks in a 7-cube: mixed orientations lift 6 to 8', () => {
    const u = unit(perms([2, 3, 5]))
    const carton: Vec3 = [7, 7, 7]
    const grid = gridFillQuantity(u, carton, NO_GAPS, Infinity)
    expect(grid.count).toBe(6)
    const bound = quantityUpperBound(u, carton, NO_GAPS, Infinity)
    const r = refineQuantity(u, carton, NO_GAPS, Infinity, grid.count, bound)
    expect(r!.count).toBe(8)
    expect(validatePlacements(r!.placements, carton, { clearances: NO_GAPS })).toEqual([])
  })

  it('honors clearances while refining, and the judge checks them', () => {
    const clearances: Clearances = { betweenParts: 0.5, wall: 0 }
    const u = DOMINO()
    const grid = gridFillQuantity(u, CUBE3, clearances, Infinity)
    const bound = quantityUpperBound(u, CUBE3, clearances, Infinity)
    const r = refineQuantity(u, CUBE3, clearances, Infinity, grid.count, bound)
    if (r !== null) {
      expect(r.count).toBeGreaterThan(grid.count)
      expect(r.count).toBeLessThanOrEqual(bound)
      expect(validatePlacements(r.placements, CUBE3, { clearances })).toEqual([])
    } else {
      // If EP cannot beat the grid under this gap, the floor stands — but the
      // case must not pass vacuously via an input error.
      expect(grid.count).toBeGreaterThan(0)
    }
  })

  it('is deterministic: identical refinement on repeated runs', () => {
    const u = unit(perms([2, 3, 5]))
    const carton: Vec3 = [7, 7, 7]
    const a = refineQuantity(u, carton, NO_GAPS, Infinity, 6, 11)
    const b = refineQuantity(u, carton, NO_GAPS, Infinity, 6, 11)
    expect(a).toEqual(b)
  })
})

describe('refineQuantity — binding attribution (the grid convention)', () => {
  it('weight capping the refined count reports weight, including on the exact tie', () => {
    // 10 g dominoes: geometry would allow 13, the cap stops the count short.
    // The grid at 9 called it geometry; the refined answer reaches the cap, so
    // weight is now what stops a better answer — the attribution must move.
    for (const [cap, expected] of [
      [100, 10],
      [110, 11],
      [120, 12]
    ] as const) {
      const u = unit(perms([1, 1, 2]), 10)
      const grid = gridFillQuantity(u, CUBE3, NO_GAPS, cap)
      expect(grid.count).toBe(9)
      expect(grid.binding).toBe('geometry')
      const bound = quantityUpperBound(u, CUBE3, NO_GAPS, cap)
      const r = refineQuantity(u, CUBE3, NO_GAPS, cap, grid.count, bound)
      expect(r!.count).toBe(expected)
      expect(r!.binding).toBe('weight')
    }
  })

  it('geometry stopping short of the cap reports geometry', () => {
    // Cap admits 100 dominoes; the carton holds 13. Geometry binds.
    const u = unit(perms([1, 1, 2]), 10)
    const r = refineQuantity(u, CUBE3, NO_GAPS, 1000, 9, 13)
    expect(r!.count).toBe(13)
    expect(r!.binding).toBe('geometry')
  })

  it('trusts the engine\'s own weight rejection when the two floors disagree by one', () => {
    // Adversarial-verify refutation, pinned. weightCapacity's RELATIVE
    // floorTolerant (1e-9) rescues more than extremePointFit's ABSOLUTE-EPS
    // cap test once total weight tops 1 kg: with 1 kg dominoes and a cap
    // 5 µg short of 11 kg (deficit above EPS = 1e-6 g, inside the relative
    // window 11 kg · 1e-9 = 11 µg), weightCapacity says 11 while EP
    // weight-rejects the 11th copy and places 10. The first build recomputed
    // binding from weightCapacity alone — 11 ≤ 10 is false — and shipped
    // 'geometry' for a count that weight had just capped, with geometry
    // provably holding 13. The rejection-derived label is authoritative.
    const u = unit(perms([1, 1, 2]), 1000)
    const cap = 11 * 1000 - 5e-6
    const grid = gridFillQuantity(u, CUBE3, NO_GAPS, cap)
    expect(grid.count).toBe(9)
    const bound = quantityUpperBound(u, CUBE3, NO_GAPS, cap)
    expect(bound).toBe(11)
    const r = refineQuantity(u, CUBE3, NO_GAPS, cap, grid.count, bound)
    expect(r!.count).toBe(10)
    expect(r!.binding).toBe('weight')
  })
})

describe('refineQuantity — the ratchet and the skips', () => {
  it('returns null when the grid already met the rigorous bound (proof, no search)', () => {
    // 10-cubes tile a 30-cube exactly: grid 27 = bound 27 — the lattice is
    // provably optimal and the attempt is skipped outright.
    const u = unit([opt(10, 10, 10)])
    const carton: Vec3 = [30, 30, 30]
    expect(gridFillQuantity(u, carton, NO_GAPS, Infinity).count).toBe(27)
    expect(quantityUpperBound(u, carton, NO_GAPS, Infinity)).toBe(27)
    expect(refineQuantity(u, carton, NO_GAPS, Infinity, 27, 27)).toBeNull()
  })

  it('returns null when EP runs and cannot strictly beat the grid', () => {
    // Measured: grid 30, bound 38, EP places ≤ 30 — the attempt runs and the
    // grid stands. This is the loss path the fuzz found for raw EP in fit
    // check, arriving in quantity mode with the same one-way-ratchet answer.
    const u = unit(perms([130, 90, 60]))
    const carton: Vec3 = [300, 300, 300]
    const grid = gridFillQuantity(u, carton, NO_GAPS, Infinity)
    expect(grid.count).toBe(30)
    const bound = quantityUpperBound(u, carton, NO_GAPS, Infinity)
    expect(bound).toBeGreaterThan(grid.count)
    expect(refineQuantity(u, carton, NO_GAPS, Infinity, grid.count, bound)).toBeNull()
  })

  it('returns null on the post-run tie: fed plenty of copies, placed no more than the grid', () => {
    // No bound passed, so 512 dominoes are fed; EP places its perfect 13 —
    // which does not beat a claimed grid of 13, and the incumbent stands.
    expect(refineQuantity(DOMINO(), CUBE3, NO_GAPS, Infinity, 13, undefined)).toBeNull()
  })

  it('returns null when the grid count is at or past the copy ceiling', () => {
    const u = unit([opt(10, 10, 10)])
    expect(
      refineQuantity(u, [1000, 1000, 1000], NO_GAPS, Infinity, MAX_REFINE_COPIES, 1000)
    ).toBeNull()
  })

  it('returns null for a zero or garbage grid count — refinement never conjures a floor', () => {
    const u = DOMINO()
    expect(refineQuantity(u, CUBE3, NO_GAPS, Infinity, 0, 13)).toBeNull()
    expect(refineQuantity(u, CUBE3, NO_GAPS, Infinity, NaN, 13)).toBeNull()
  })

  it('refuses noise-thin orientations by the grid engine\'s own bar', () => {
    // A 30×20 sheet with 1e-6 mm of float-noise thickness: the grid counted it
    // as zero on purpose (the OOM finding); EP must not "refine" that refusal
    // into thousands of noise sheets — even when handed a nonzero floor.
    const u = unit([opt(30, 20, 1e-6), opt(20, 30, 1e-6)])
    expect(refineQuantity(u, [100, 100, 100], NO_GAPS, Infinity, 5, 500)).toBeNull()
  })
})

describe('pack() integration — max(grid, EP) end to end', () => {
  /** 8-corner axis-aligned box part (the orchestrator tests' builder). */
  function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
    const pts: number[][] = []
    for (const x of [0, size[0]])
      for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
    const positions = new Float32Array(pts.length * 3)
    pts.forEach((p, i) => positions.set(p, i * 3))
    return { name, positions, weightG }
  }

  const request = (
    parts: PackPart[],
    carton: Vec3,
    maxWeightG = Infinity
  ): PackRequest => ({
    mode: 'max-quantity',
    tier: 'fast',
    carton,
    clearances: NO_GAPS,
    maxWeightG,
    parts
  })

  it('the domino request now answers 13 (upper bound 13), utilization from placements', () => {
    const result = pack(request([boxPart('d', [1, 1, 2])], CUBE3))
    expect(result.mode).toBe('max-quantity')
    if (result.mode !== 'max-quantity') return
    expect(result.count).toBe(13)
    expect(result.upperBound).toBe(13)
    expect(result.placements).toHaveLength(13)
    expect(result.binding).toBe('geometry')
    expect(result.heuristic).toBe(true)
    // 13 dominoes of volume 2 in a 27 mm³ carton, summed from what was placed.
    expect(result.utilization).toBeCloseTo(26 / 27, 12)
    expect(validatePlacements(result.placements, CUBE3, { clearances: NO_GAPS })).toEqual([])
  })

  it('keeps the grid result bit-identical when refinement has nothing to add', () => {
    const parts = [boxPart('c', [10, 10, 10])]
    const carton: Vec3 = [30, 30, 30]
    const result = pack(request(parts, carton))
    if (result.mode !== 'max-quantity') return
    const grid = gridFillQuantity(
      { name: 'c', weightG: 0, orientations: perms([10, 10, 10]) },
      carton,
      NO_GAPS,
      Infinity
    )
    expect(result.count).toBe(grid.count)
    expect(result.placements).toEqual(grid.placements)
    expect(result.binding).toBe(grid.binding)
  })

  it('a weight cap mid-refinement surfaces as weight-bound at the refined count', () => {
    const result = pack(request([boxPart('d', [1, 1, 2], 10)], CUBE3, 110))
    if (result.mode !== 'max-quantity') return
    expect(result.count).toBe(11)
    expect(result.binding).toBe('weight')
    expect(result.upperBound).toBe(11)
  })

  it('is deterministic end to end', () => {
    const a = pack(request([boxPart('d', [1, 1, 2])], CUBE3))
    const b = pack(request([boxPart('d', [1, 1, 2])], CUBE3))
    expect(a).toEqual(b)
  })
})
