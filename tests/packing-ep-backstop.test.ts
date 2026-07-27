import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import occtFactory, { type OcctModule } from 'occt-import-js'
import { extractParts } from '../src/renderer/src/workers/occt/occt-to-parts'
import {
  DEFAULT_MAX_EP_OPS,
  extremePointFit
} from '../src/renderer/src/core/packing/extremePointFit'
import { aabbOrientations } from '../src/renderer/src/core/packing/orientations'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  Vec3
} from '../src/renderer/src/core/packing/types'

// The operation backstop (ADR-0022 §6, build plan phase 3). Two jobs, and the
// second is the one that could not be done by reading the code:
//
// 1. CONTRACT — the abort is clean. A tripped search leaves a valid, truncated
//    arrangement (every placement still passes the independent validator), reports
//    `backstopTripped`, and labels the binding constraint honestly. And it is
//    deterministic: the counter is a COUNT, never a clock, so the same input trips
//    at exactly the same place on every machine and every run. A wall-clock budget
//    would make the answer depend on machine load — the reason §6 forbids it.
//
// 2. SIZING — the constant is MEASURED, not guessed (build plan risk 2), because
//    phase 4's quantity refinement inherits its depth from this number. These tests
//    are the measurement, kept as a standing guard: if realistic fit-check loads
//    ever creep toward the budget, the headroom assertions fail here rather than a
//    user watching a good answer silently degrade into the incumbent's.
//
// The load ladder below is deliberately generous about what "realistic" means. A
// fit check receives one CAD file's parts, and every part in it was modelled by
// hand — 250 distinct solids is already far past any assembly this app is aimed at,
// and the AS1 golden (18) is the real-world anchor.

const SAMPLES = join(__dirname, '..', 'samples')
const NO_GAPS: Clearances = { betweenParts: 0, wall: 0 }
const IN = 25.4

const opt = (ex: number, ey: number, ez: number): OrientationOption => ({
  extent: [ex, ey, ez],
  rotation: IDENTITY_MAT3,
  rotatedMin: [0, 0, 0]
})

/** All distinct axis permutations of the dims, as orientation options — the same
 *  6 the fast tier's provider yields for a real part. */
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

/** A seeded heterogeneous part set — mixed aspect ratios, the load shelf handles
 *  worst and EP works hardest on. Seeded so the measured numbers are reproducible. */
function mixedLoad(n: number, seed = 20260727): PackBox[] {
  let s = seed
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const boxes: PackBox[] = []
  for (let i = 0; i < n; i++) {
    const d: Vec3 = [10 + Math.round(rnd() * 60), 10 + Math.round(rnd() * 60), 5 + Math.round(rnd() * 40)]
    boxes.push({ name: `part-${i}`, weightG: 0, orientations: perms(d) })
  }
  return boxes
}

describe('EP operation backstop — the clean abort', () => {
  it('reports the work done, and the same input always costs the same', () => {
    const boxes = mixedLoad(20)
    const a = extremePointFit(boxes, [300, 300, 300], NO_GAPS, 1e9)
    const b = extremePointFit(boxes, [300, 300, 300], NO_GAPS, 1e9)
    expect(a.ops).toBeGreaterThan(0)
    expect(a.backstopTripped).toBe(false)
    expect(b.ops).toBe(a.ops)
    expect(b.placements).toEqual(a.placements)
  })

  it('a spent budget truncates the arrangement without corrupting it', () => {
    const carton: Vec3 = [300, 300, 300]
    const boxes = mixedLoad(30)
    const full = extremePointFit(boxes, carton, NO_GAPS, 1e9)
    const cut = extremePointFit(boxes, carton, NO_GAPS, 1e9, { maxOps: 200 })

    expect(full.backstopTripped).toBe(false)
    expect(cut.backstopTripped).toBe(true)
    // Truncated, not broken: fewer parts placed than the full search, every one of
    // them still physically real, and nothing lost track of — placed + unplaced is
    // still the whole input.
    expect(cut.placements.length).toBeGreaterThan(0)
    expect(cut.placements.length).toBeLessThan(full.placements.length)
    expect(cut.placements.length + cut.unplaced.length).toBe(boxes.length)
    expect(validatePlacements(cut.placements, carton)).toEqual([])
    // The strong form: a truncated run is a PREFIX of the full one, part for part
    // and coordinate for coordinate. Every decision before the trip was taken
    // under the complete rule set, so the budget changes where the search stops
    // and nothing else. This is what the mid-box abandon buys — placing a
    // half-searched best would make that last placement depend on where the
    // counter happened to run out.
    expect(full.placements.slice(0, cut.placements.length)).toEqual(cut.placements)
  })

  it('a trip is never labelled a weight limit', () => {
    // The parts must CARRY WEIGHT for this to test anything. Written first with
    // weightless parts, it passed against the mutation that drops the trip from
    // the binding rule — with every weight zero the headroom comparison can only
    // ever say 'geometry', so the guard was never consulted. Here 30 × 100 g sits
    // under a 4 kg cap (so nothing is weight-rejected), and a truncated run places
    // only a few parts: weight headroom is spent faster than volume, so the
    // fall-through comparison WOULD label this 'weight' — a truncation reported as
    // the shipping limit binding.
    const boxes = mixedLoad(30).map((b) => ({ ...b, weightG: 100 }))
    const r = extremePointFit(boxes, [300, 300, 300], NO_GAPS, 4000, { maxOps: 200 })
    expect(r.backstopTripped).toBe(true)
    expect(r.unplaced.length).toBeGreaterThan(0)
    expect(r.binding).toBe('geometry')
  })

  it('trips identically every run — the count is deterministic, not a clock', () => {
    const boxes = mixedLoad(30)
    const runs = [0, 1, 2].map(() =>
      extremePointFit(boxes, [300, 300, 300], NO_GAPS, 1e9, { maxOps: 5000 })
    )
    for (const r of runs) expect(r.backstopTripped).toBe(true)
    expect(runs[1].ops).toBe(runs[0].ops)
    expect(runs[2].ops).toBe(runs[0].ops)
    expect(runs[1].unplaced).toEqual(runs[0].unplaced)
    expect(runs[1].placements).toEqual(runs[0].placements)
  })

  it('a budget of zero places nothing, and says so rather than claiming non-fit', () => {
    const r = extremePointFit([{ name: 'a', weightG: 0, orientations: perms([10, 10, 10]) }], [100, 100, 100], NO_GAPS, 1e9, {
      maxOps: 0
    })
    expect(r.backstopTripped).toBe(true)
    expect(r.placements).toEqual([])
    expect(r.unplaced).toEqual(['a'])
  })

  it('a garbled budget falls back to the default instead of disabling the backstop', () => {
    // NaN is the dangerous one: `ops > NaN` is always false, so an unclamped NaN
    // budget would silently remove the backstop entirely rather than shrink it.
    const boxes = mixedLoad(10)
    const good = extremePointFit(boxes, [300, 300, 300], NO_GAPS, 1e9)
    for (const maxOps of [NaN, -1, Infinity]) {
      const r = extremePointFit(boxes, [300, 300, 300], NO_GAPS, 1e9, { maxOps })
      expect(r.backstopTripped).toBe(false)
      expect(r.ops).toBe(good.ops)
      expect(r.placements).toEqual(good.placements)
    }
  })
})

describe('EP operation backstop — the sizing measurement', () => {
  // Headroom is stated as a RATIO against the shipped constant, so the assertions
  // keep their meaning if the constant is ever retuned. The loads are seeded, so
  // these numbers are fixed: a failure here means the engine's cost profile moved,
  // which is exactly when the sizing needs looking at again.
  const headroom = (ops: number): number => DEFAULT_MAX_EP_OPS / ops

  it('a 100-part fit check spends a twentieth of the budget', () => {
    // Snug carton: the parts nearly fill it, so almost every candidate is tested
    // against almost every placed box — this engine's expensive case. Measured
    // 1.1e7 ops / 123 ms; the ladder past this point is in DEFAULT_MAX_EP_OPS's
    // comment rather than here, because 250 parts costs 1.9 s and this suite runs
    // twice on every ship.
    const r = extremePointFit(mixedLoad(100), [250, 250, 250], NO_GAPS, 1e9)
    expect(r.backstopTripped).toBe(false)
    expect(headroom(r.ops)).toBeGreaterThan(10)
  })

  it('the budget is a bound on cost, not a number that can never be reached', () => {
    // The counterweight to the headroom assertions: a constant sized so generously
    // that nothing trips it would be a backstop in name only. Ops grow with the
    // cube of the part count, so 500 parts (1.5e9 ops, 15 s measured) is past it —
    // and that is the point, since a 15-second search is the responsiveness failure
    // §4 asks this number to prevent.
    const r = extremePointFit(mixedLoad(500), [500, 500, 500], NO_GAPS, 1e9)
    expect(r.backstopTripped).toBe(true)
    expect(validatePlacements(r.placements, [500, 500, 500])).toEqual([])
  })
})

describe('EP operation backstop — the real-workload anchor', () => {
  const headroomOf = (ops: number): number => DEFAULT_MAX_EP_OPS / ops
  let occt: OcctModule
  beforeAll(async () => {
    occt = await occtFactory()
  }, 60_000)

  it('the AS1 assembly in its golden carton is nowhere near the budget', () => {
    // The same file and carton as the `AS1 assembly fits a 24 in carton` golden:
    // 18 real solids, real dimensions, the fast tier's real orientation provider.
    const result = occt.ReadStepFile(
      new Uint8Array(readFileSync(join(SAMPLES, 'as1-oc-214.stp'))),
      { linearUnit: 'millimeter' }
    )
    const boxes: PackBox[] = extractParts(result).map((p) => ({
      name: p.name,
      weightG: 0,
      orientations: aabbOrientations({ name: p.name, positions: p.positions, weightG: 0 })
    }))
    expect(boxes).toHaveLength(18)

    const carton: Vec3 = [24 * IN, 24 * IN, 24 * IN]
    const r = extremePointFit(boxes, carton, NO_GAPS, 1e9)
    expect(r.unplaced).toEqual([])
    expect(r.backstopTripped).toBe(false)
    expect(validatePlacements(r.placements, carton)).toEqual([])
    // Measured 4.6e4 ops, ~5 ms: the load this app is actually aimed at spends
    // two hundredths of one percent of the budget.
    expect(headroomOf(r.ops)).toBeGreaterThan(1000)
  })
})
