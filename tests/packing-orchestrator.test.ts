import { describe, expect, it } from 'vitest'
import { beatsIncumbent, pack } from '../src/renderer/src/core/packing/pack'
import { aabbOrientations, applyMat3 } from '../src/renderer/src/core/packing/orientations'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import { MAX_GRID_PLACEMENTS } from '../src/renderer/src/core/packing/quantityGrid'
import type {
  Clearances,
  FitPlacement,
  Mat3,
  Placement,
  PackMode,
  PackPart,
  PackRequest,
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

// --- the incumbent race (ADR-0022 §2) --------------------------------------
// fitCheck runs greedy shelf AND extreme-point placement and returns the better
// of the two. The property that matters is a RATCHET: the answer can only improve
// on what shelf alone produced, never regress, because engines are invisible to
// the user and a worse verdict is the one regression they would notice.

describe('pack — fit-check races shelf against extreme-point', () => {
  // Hand-derived from the shelf weakness ADR-0003 named in its own consequences.
  // Volumes sort a (20 000) > c (16 000) > b (12 000), so the order is a, c, b.
  // Shelf: a lies flat as 50×40×10 at the origin; c opens a NEW SHELF beside it
  // at y = 40 as 40×10×40; b then has nowhere to go — the row is full, the next
  // shelf would start at y = 50, and a new LAYER starts at z = 40 with only 10 mm
  // of height left. The 40 mm of empty air directly above a was abandoned the
  // moment the shelf cursor moved on. Extreme-point keeps that corner as a
  // candidate and drops b straight into it.
  const SHELF_BLIND_SPOT: [string, Vec3][] = [
    ['a', [10, 40, 50]],
    ['b', [20, 30, 20]],
    ['c', [10, 40, 40]]
  ]
  const CARTON: Vec3 = [50, 50, 50]

  it('fits a set that shelf alone declares unfittable', () => {
    const parts = SHELF_BLIND_SPOT.map(([n, s]) => boxPart(n, s))
    const shelfAlone = greedyShelfFit(
      parts.map((p) => ({ name: p.name, weightG: p.weightG, orientations: aabbOrientations(p) })),
      CARTON,
      NO_CLEARANCE,
      Infinity
    )
    expect(shelfAlone.unplaced).toEqual(['b']) // the incumbent's own answer, first

    const r = pack(request('fit-check', parts, CARTON))
    if (r.mode !== 'fit-check') return
    expect(r.fits).toBe(true)
    expect(r.unplaced).toEqual([])
    // The winner's placements are what ships — and they are judged by the
    // independent validator, not by the engine that produced them.
    expect(r.placements).toHaveLength(3)
    expect(validatePlacements(r.placements, CARTON, { clearances: NO_CLEARANCE })).toEqual([])
    expect(r.heuristic).toBe(true) // the better of two heuristics is still one
  })

  it('never returns fewer placed parts than the incumbent would alone', () => {
    // The ratchet, over a spread of cartons rather than one lucky case: whatever
    // shelf achieves is a floor the raced answer must meet or beat.
    const parts = SHELF_BLIND_SPOT.map(([n, s]) => boxPart(n, s))
    const boxes = parts.map((p) => ({
      name: p.name,
      weightG: p.weightG,
      orientations: aabbOrientations(p)
    }))
    for (const side of [30, 40, 45, 50, 60, 80, 100]) {
      const carton: Vec3 = [side, side, side]
      const shelfAlone = greedyShelfFit(boxes, carton, NO_CLEARANCE, Infinity)
      const r = pack(request('fit-check', parts, carton))
      if (r.mode !== 'fit-check') return
      expect(r.placements.length, `carton ${side}`).toBeGreaterThanOrEqual(
        shelfAlone.placements.length
      )
      expect(validatePlacements(r.placements, carton), `carton ${side}`).toEqual([])
    }
  })

  it('utilization and binding are read off the winner, not the loser', () => {
    const parts = SHELF_BLIND_SPOT.map(([n, s]) => boxPart(n, s))
    const r = pack(request('fit-check', parts, CARTON))
    if (r.mode !== 'fit-check') return
    // All three placed: 20 000 + 12 000 + 16 000 mm³ of 125 000.
    expect(r.utilization).toBeCloseTo(48000 / 125000, 10)
    expect(r.binding).toBe('geometry')
  })

  it('the weight cap still binds when the challenger wins on geometry', () => {
    // A weight rejection must survive the race: the challenger placing more parts
    // does not make the cap stop being the reason the rest were left out.
    const parts = SHELF_BLIND_SPOT.map(([n, s], i) => boxPart(n, s, i === 2 ? 5000 : 100))
    const r = pack(request('fit-check', parts, CARTON, { maxWeightG: 1000 }))
    if (r.mode !== 'fit-check') return
    expect(r.fits).toBe(false)
    expect(r.unplaced).toContain('c')
    expect(r.binding).toBe('weight')
  })
})

describe('beatsIncumbent', () => {
  const at = (name: string, min: Vec3, max: Vec3): Placement => ({
    partName: name,
    rotation: IDENTITY_MAT3,
    translation: [0, 0, 0],
    boxMin: min,
    boxMax: max
  })
  const fit = (placements: Placement[], unplaced: string[]): FitPlacement => ({
    placements,
    unplaced,
    binding: 'geometry'
  })

  it('fewer unplaced wins — that is the question fit check asks', () => {
    const challenger = fit([at('a', [0, 0, 0], [1, 1, 1])], [])
    const incumbent = fit([], ['a'])
    expect(beatsIncumbent(challenger, incumbent)).toBe(true)
    expect(beatsIncumbent(incumbent, challenger)).toBe(false)
  })

  it('on a tie, more volume placed wins — the same count is not the same answer', () => {
    const big = fit([at('a', [0, 0, 0], [10, 10, 10])], ['x'])
    const small = fit([at('b', [0, 0, 0], [1, 1, 1])], ['y'])
    expect(beatsIncumbent(big, small)).toBe(true)
    expect(beatsIncumbent(small, big)).toBe(false)
  })

  it('a dead heat leaves the incumbent standing', () => {
    // The one-way ratchet: a challenger that cannot demonstrate an improvement
    // does not get to change the answer.
    const a = fit([at('a', [0, 0, 0], [10, 10, 10])], [])
    const b = fit([at('a', [5, 5, 5], [15, 15, 15])], [])
    expect(beatsIncumbent(a, b)).toBe(false)
    expect(beatsIncumbent(b, a)).toBe(false)
  })

  it('last-ulp noise is not an improvement', () => {
    // The two sums add the same volumes in different orders, so an arrangement
    // that is genuinely equal can come out a few ulps ahead. Without the margin,
    // that noise would decide the race instead of the rule.
    const incumbent = fit([at('a', [0, 0, 0], [0.1, 0.3, 0.7])], [])
    const challenger = fit(
      [at('a', [0, 0, 0], [0.1, 0.3, 0.7 + Number.EPSILON])],
      []
    )
    expect(beatsIncumbent(challenger, incumbent)).toBe(false)
  })
})
