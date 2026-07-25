import { describe, expect, it } from 'vitest'
import { pack, verdictCaption } from '../src/renderer/src/core/packing/pack'
import { applyMat3 } from '../src/renderer/src/core/packing/orientations'
import { MAX_GRID_PLACEMENTS } from '../src/renderer/src/core/packing/quantityGrid'
import type {
  Clearances,
  Mat3,
  PackMode,
  PackPart,
  PackRequest,
  QualityTier,
  Vec3
} from '../src/renderer/src/core/packing/types'

// packing-unit-tests (ADR-0003 phase 5) — the orchestrator layer plus the
// cross-cutting invariants the plan mandates: binding both ways, thorough ≥ fast
// on identical input, part-larger-than-carton, truncation honesty, utilization.

const NO_CLEARANCE: Clearances = { betweenParts: 0, wall: 0 }

/** 8-corner axis-aligned box [0..sx, 0..sy, 0..sz] — enough for both the fast
 *  AABB and the thorough convex hull (needs a real 3D point set). */
function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
  const pts: number[][] = []
  for (const x of [0, size[0]]) for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
  const positions = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => positions.set(p, i * 3))
  return { name, positions, weightG }
}

/** The 8 corners of an sx×sy×sz box rotated by m (an off-axis rod: fat AABB,
 *  slim OBB). */
function rotatedBoxPart(name: string, size: Vec3, m: Mat3, weightG = 0): PackPart {
  const base = boxPart(name, size, weightG)
  const out = new Float32Array(base.positions.length)
  for (let i = 0; i < base.positions.length; i += 3) {
    const r = applyMat3(m, [base.positions[i], base.positions[i + 1], base.positions[i + 2]])
    out.set(r, i)
  }
  return { name, positions: out, weightG }
}

const R345: Mat3 = [0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0, 0.6]

function request(
  mode: PackMode,
  parts: PackPart[],
  carton: Vec3,
  opts: Partial<Pick<PackRequest, 'tier' | 'clearances' | 'maxWeightG'>> = {}
): PackRequest {
  return {
    mode,
    tier: opts.tier ?? 'fast',
    carton,
    clearances: opts.clearances ?? NO_CLEARANCE,
    maxWeightG: opts.maxWeightG ?? Infinity,
    parts
  }
}

describe('pack — fit-check', () => {
  it('reports fits with a concrete arrangement and geometry binding', () => {
    const r = pack(request('fit-check', [boxPart('a', [10, 10, 10])], [100, 100, 100]))
    expect(r.mode).toBe('fit-check')
    if (r.mode !== 'fit-check') return
    expect(r.fits).toBe(true)
    expect(r.unplaced).toEqual([])
    expect(r.placements).toHaveLength(1)
    expect(r.binding).toBe('geometry')
    expect(r.heuristic).toBe(true)
    expect(r.utilization).toBeCloseTo(1000 / 1e6, 9)
  })

  it('part larger than the carton does not fit (geometry binding)', () => {
    const r = pack(request('fit-check', [boxPart('long', [200, 10, 10])], [100, 100, 100]))
    if (r.mode !== 'fit-check') return
    expect(r.fits).toBe(false)
    expect(r.unplaced).toEqual(['long'])
    expect(r.binding).toBe('geometry')
  })

  it('binds on WEIGHT when parts fit spatially but exceed the cap (hand-computed)', () => {
    // Three 10³ parts at 1000 g each in a roomy carton, cap 2500 g → 2 placed,
    // the third weight-rejected without consuming space.
    const parts = [
      boxPart('a', [10, 10, 10], 1000),
      boxPart('b', [10, 10, 10], 1000),
      boxPart('c', [10, 10, 10], 1000)
    ]
    const r = pack(request('fit-check', parts, [100, 100, 100], { maxWeightG: 2500 }))
    if (r.mode !== 'fit-check') return
    expect(r.fits).toBe(false)
    expect(r.unplaced).toEqual(['c'])
    expect(r.binding).toBe('weight')
  })
})

describe('pack — max-quantity', () => {
  it('counts a grid and computes utilization from count × cell (fast tier)', () => {
    const r = pack(request('max-quantity', [boxPart('u', [10, 10, 10])], [100, 100, 100]))
    expect(r.mode).toBe('max-quantity')
    if (r.mode !== 'max-quantity') return
    expect(r.count).toBe(1000) // 10 × 10 × 10
    expect(r.binding).toBe('geometry')
    expect(r.utilization).toBeCloseTo(1, 9) // 1000 × 1000 mm³ = carton volume
  })

  it('reports the true count but materializes at most MAX_GRID_PLACEMENTS', () => {
    const r = pack(request('max-quantity', [boxPart('tiny', [1, 1, 1])], [600, 600, 600]))
    if (r.mode !== 'max-quantity') return
    expect(r.count).toBe(600 * 600 * 600)
    expect(r.placements.length).toBe(MAX_GRID_PLACEMENTS)
    expect(r.utilization).toBeCloseTo(1, 6) // count derived, not placements.length
  })

  it('binds on WEIGHT vs GEOMETRY as the cap dictates (both ways, hand-computed)', () => {
    const heavy = pack(
      request('max-quantity', [boxPart('u', [10, 10, 10], 1000)], [100, 100, 100], { maxWeightG: 5000 })
    )
    if (heavy.mode !== 'max-quantity') return
    expect(heavy.count).toBe(5) // floor(5000 / 1000), geometry allows 1000
    expect(heavy.binding).toBe('weight')

    const light = pack(
      request('max-quantity', [boxPart('u', [10, 10, 10], 1)], [100, 100, 100], { maxWeightG: 1e9 })
    )
    if (light.mode !== 'max-quantity') return
    expect(light.count).toBe(1000)
    expect(light.binding).toBe('geometry')
  })

  it('a unit larger than the carton yields zero', () => {
    const r = pack(request('max-quantity', [boxPart('big', [200, 200, 200])], [100, 100, 100]))
    if (r.mode !== 'max-quantity') return
    expect(r.count).toBe(0)
    expect(r.placements).toEqual([])
    expect(r.utilization).toBe(0)
  })

  it('composes multiple parts into one rigid unit', () => {
    // Two 10³ boxes 50 mm apart compose to a ~60×10×10 unit; only ~1 per 100 mm
    // run along the long axis but stacked in the other two.
    const a = boxPart('a', [10, 10, 10])
    const bShifted: PackPart = {
      name: 'b',
      positions: a.positions.map((v, i) => (i % 3 === 0 ? v + 50 : v)) as Float32Array,
      weightG: 0
    }
    const r = pack(request('max-quantity', [a, bShifted], [100, 100, 100]))
    if (r.mode !== 'max-quantity') return
    // Unit AABB 60×10×10: floor(100/60)=1 along x, 10 along y, 10 along z → 100.
    expect(r.count).toBe(100)
  })

  it('empty parts list yields a zero result without throwing', () => {
    const r = pack(request('max-quantity', [], [100, 100, 100]))
    if (r.mode !== 'max-quantity') return
    expect(r.count).toBe(0)
    expect(r.binding).toBe('geometry')
  })
})

describe('pack — thorough ≥ fast (superset guarantee at the orchestrator)', () => {
  it('ties on an axis-aligned box (OBB == AABB)', () => {
    const carton: Vec3 = [95, 95, 95]
    const fast = pack(request('max-quantity', [boxPart('u', [30, 20, 10])], carton, { tier: 'fast' }))
    const thorough = pack(
      request('max-quantity', [boxPart('u', [30, 20, 10])], carton, { tier: 'thorough' })
    )
    if (fast.mode !== 'max-quantity' || thorough.mode !== 'max-quantity') return
    expect(thorough.count).toBeGreaterThanOrEqual(fast.count)
    expect(thorough.count).toBe(fast.count)
  })

  it('beats fast on a diagonally rotated rod', () => {
    const rod = rotatedBoxPart('rod', [40, 8, 8], R345)
    const carton: Vec3 = [100, 100, 100]
    const fast = pack(request('max-quantity', [rod], carton, { tier: 'fast' }))
    const thorough = pack(request('max-quantity', [rod], carton, { tier: 'thorough' }))
    if (fast.mode !== 'max-quantity' || thorough.mode !== 'max-quantity') return
    expect(thorough.count).toBeGreaterThan(fast.count)
  })

  it('fit-check: thorough places a rod that fast cannot in a tight carton', () => {
    const rod = rotatedBoxPart('rod', [40, 8, 8], R345)
    const carton: Vec3 = [45, 10, 10] // only the OBB orientation fits
    const fast = pack(request('fit-check', [rod], carton, { tier: 'fast' }))
    const thorough = pack(request('fit-check', [rod], carton, { tier: 'thorough' }))
    if (fast.mode !== 'fit-check' || thorough.mode !== 'fit-check') return
    expect(fast.fits).toBe(false)
    expect(thorough.fits).toBe(true)
  })
})

describe('verdictCaption', () => {
  const tier: QualityTier = 'fast'
  it('labels a positive fit as a found arrangement', () => {
    const r = pack(request('fit-check', [boxPart('a', [10, 10, 10])], [100, 100, 100], { tier }))
    expect(verdictCaption(r)).toMatch(/All 1 part fit/)
  })

  it('labels a non-fit as heuristic, not a proof', () => {
    const r = pack(request('fit-check', [boxPart('long', [200, 10, 10])], [100, 100, 100], { tier }))
    expect(verdictCaption(r)).toMatch(/not a proof the rest cannot fit/)
  })

  it('labels a quantity as a lower bound with the binding reason', () => {
    const r = pack(
      request('max-quantity', [boxPart('u', [10, 10, 10], 1000)], [100, 100, 100], {
        tier,
        maxWeightG: 5000
      })
    )
    expect(verdictCaption(r)).toMatch(/At least 5 fit \(weight-limited\)\. Heuristic/)
  })

  it('handles the empty and none cases', () => {
    const empty = pack(request('fit-check', [], [100, 100, 100], { tier }))
    expect(verdictCaption(empty)).toBe('Nothing to pack.')
    const none = pack(request('max-quantity', [boxPart('big', [200, 200, 200])], [100, 100, 100], { tier }))
    expect(verdictCaption(none)).toBe('None fit in this carton.')
  })
})
