import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pack } from '../src/renderer/src/core/packing/pack'
import { extremePointFit } from '../src/renderer/src/core/packing/extremePointFit'
import { emptyMaximalSpaces, largestFreeSpace } from '../src/renderer/src/core/packing/ems'
import { refineQuantity } from '../src/renderer/src/core/packing/quantityRefine'
import { aabbOrientations } from '../src/renderer/src/core/packing/orientations'
import type {
  Clearances,
  PackBox,
  PackMode,
  PackPart,
  PackRequest,
  QualityTier,
  Vec3
} from '../src/renderer/src/core/packing/types'

// determinism-tests (ADR-0022 build-plan phase 5). The ADR makes this a
// REQUIREMENT, not a nice-to-have: "same inputs must give the same placement".
//
// WHY IT NEEDS ITS OWN SUITE, when every other packing spec asserts exact
// numbers: those specs run each case once. An unstable ordering does not make a
// placement wrong — it makes it *different between runs*, and every existing
// assertion would keep passing on whichever arrangement it happened to be
// written against. What a user would see is an estimate that changes when they
// retype the same number, or a saved estimate that will not reproduce; both are
// worse than a wrong answer, because neither is repeatable enough to report.
//
// The instabilities actually reachable in this code, all of which the phase 2–4
// engines were written against and this suite pins:
//   - an inconsistent sort comparator (NaN volumes), whose order is
//     implementation-defined;
//   - the ulp trap: mathematically equal volumes differing in the last bit, so
//     noise rather than the documented tie-break picks a winner (hence the
//     sorted-factor products in extremePointFit, ems and pack);
//   - Set/Map ITERATION order standing in for a decision (both are used for
//     membership only, never iterated);
//   - unseeded randomness or a clock, which ADR-0022 §6 rules out for the
//     backstop and which nothing in core/packing may reach for.
//
// Every case rebuilds its request from scratch, with fresh Float32Arrays: passing
// the same object twice would let memoization hide a real instability.

const NO_CLEARANCE: Clearances = { betweenParts: 0, wall: 0 }
const RUNS = 5

function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
  const pts: number[][] = []
  for (const x of [0, size[0]]) for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
  const positions = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => positions.set(p, i * 3))
  return { name, positions, weightG }
}

interface Case {
  name: string
  mode: PackMode
  tier?: QualityTier
  carton: Vec3
  clearances?: Clearances
  maxWeightG?: number
  parts: readonly (readonly [string, Vec3, number?])[]
}

/** Builds a structurally identical request every call — never a shared object. */
function build(c: Case): PackRequest {
  return {
    mode: c.mode,
    tier: c.tier ?? 'fast',
    carton: [c.carton[0], c.carton[1], c.carton[2]],
    clearances: { ...(c.clearances ?? NO_CLEARANCE) },
    maxWeightG: c.maxWeightG ?? Infinity,
    parts: c.parts.map(([name, size, weightG]) => boxPart(name, size, weightG))
  }
}

// Dimensions are deliberately non-dyadic in places (7.3, 11.9): a decimal that
// cannot be represented exactly is what turns a fixed-axis volume product into
// two different numbers for two symmetric candidates.
const CASES: Case[] = [
  {
    name: 'fit-check, everything fits',
    mode: 'fit-check',
    carton: [100, 100, 100],
    parts: [
      ['a', [30, 40, 50]],
      ['b', [30, 40, 50]],
      ['c', [20, 20, 20]]
    ]
  },
  {
    name: 'fit-check, the shelf blind spot (extreme-point wins the race)',
    mode: 'fit-check',
    carton: [50, 50, 50],
    parts: [
      ['a', [10, 40, 50]],
      ['b', [20, 30, 20]],
      ['c', [10, 40, 40]]
    ]
  },
  {
    name: 'fit-check, identical parts (equal volumes — the ulp trap)',
    mode: 'fit-check',
    carton: [37.3, 37.3, 37.3],
    parts: [
      ['p1', [11.9, 7.3, 19.1]],
      ['p2', [11.9, 7.3, 19.1]],
      ['p3', [11.9, 7.3, 19.1]],
      ['p4', [11.9, 7.3, 19.1]],
      ['p5', [11.9, 7.3, 19.1]]
    ]
  },
  {
    name: 'fit-check, non-fit (carries the void and the smallest leftover)',
    mode: 'fit-check',
    carton: [50, 50, 30],
    parts: [
      ['big', [40, 40, 25]],
      ['also-big', [40, 40, 25]],
      ['small', [30, 30, 12]]
    ]
  },
  {
    name: 'fit-check with clearances (two engines, two implementations of the gap)',
    mode: 'fit-check',
    carton: [60, 60, 60],
    clearances: { betweenParts: 3.7, wall: 2.1 },
    parts: [
      ['a', [20, 20, 20]],
      ['b', [17.3, 22, 11.9]],
      ['c', [17.3, 22, 11.9]]
    ]
  },
  {
    name: 'fit-check, weight-bound',
    mode: 'fit-check',
    carton: [100, 100, 100],
    maxWeightG: 1500,
    parts: [
      ['heavy', [20, 20, 20], 900],
      ['heavier', [20, 20, 20], 900],
      ['light', [10, 10, 10], 100]
    ]
  },
  {
    name: 'fit-check, thorough tier (OBB search feeds the orientations)',
    mode: 'fit-check',
    tier: 'thorough',
    carton: [80, 80, 80],
    parts: [
      ['a', [31.7, 19.3, 45.1]],
      ['b', [31.7, 19.3, 45.1]],
      ['c', [22, 22, 22]]
    ]
  },
  {
    name: 'max-quantity, grid stands',
    mode: 'max-quantity',
    carton: [100, 100, 100],
    parts: [['cube', [20, 20, 20]]]
  },
  {
    name: 'max-quantity, refinement beats the grid (dominoes)',
    mode: 'max-quantity',
    carton: [30, 30, 30],
    parts: [['domino', [20, 10, 10]]]
  },
  {
    name: 'max-quantity, truncated layout (count exceeds materialized placements)',
    mode: 'max-quantity',
    carton: [600, 600, 600],
    parts: [['tiny', [1, 1, 1]]]
  },
  {
    name: 'max-quantity, weight-capped',
    mode: 'max-quantity',
    carton: [200, 200, 200],
    maxWeightG: 5000,
    parts: [['unit', [20, 20, 20], 700]]
  },
  {
    name: 'max-quantity, thorough tier',
    mode: 'max-quantity',
    tier: 'thorough',
    carton: [90, 90, 90],
    parts: [['rod', [11.9, 7.3, 41.1]]]
  }
]

describe('pack — the same request gives the same result, every run', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const first = pack(build(c))
      for (let run = 1; run < RUNS; run++) {
        // Deep equality over the WHOLE result, not a summary of it: a count that
        // is stable while the placements rotate is still nondeterminism, and it
        // is the placements that are drawn, exported and re-derived from.
        expect(pack(build(c))).toEqual(first)
      }
    })
  }

  it('covers both modes, both tiers, and the reporting fields', () => {
    // A guard on the matrix itself: a case list that quietly stopped exercising
    // refinement or the void would keep passing while covering nothing.
    const results = CASES.map((c) => pack(build(c)))
    expect(results.some((r) => r.mode === 'fit-check' && !r.fits && r.largestFreeSpace)).toBe(true)
    expect(results.some((r) => r.mode === 'fit-check' && r.smallestUnplaced !== undefined)).toBe(
      true
    )
    expect(results.some((r) => r.mode === 'max-quantity' && r.upperBound !== undefined)).toBe(true)
    expect(results.some((r) => r.tier === 'thorough')).toBe(true)
    expect(results.some((r) => r.binding === 'weight')).toBe(true)
  })
})

describe('the backstop trips identically every run', () => {
  // A count, never a clock (ADR-0022 §6) — so the trip is part of the input's
  // answer, not a property of how busy the machine was. A wall-clock budget
  // would make this test flaky by design, which is precisely the argument.
  const boxes: PackBox[] = Array.from({ length: 30 }, (_, i) => {
    const part = boxPart(`p${i}`, [7.3, 11.9, 13.1])
    return { name: part.name, weightG: 0, orientations: aabbOrientations(part) }
  })
  const carton: Vec3 = [60, 60, 60]

  it('the same starved budget trips at the same op count with the same prefix', () => {
    const first = extremePointFit(boxes, carton, NO_CLEARANCE, Infinity, { maxOps: 500 })
    expect(first.backstopTripped).toBe(true)
    for (let run = 1; run < RUNS; run++) {
      const again = extremePointFit(boxes, carton, NO_CLEARANCE, Infinity, { maxOps: 500 })
      expect(again.ops).toBe(first.ops)
      expect(again.backstopTripped).toBe(true)
      expect(again).toEqual(first)
    }
  })

  it('a budget that does not trip charges the same total every run', () => {
    const first = extremePointFit(boxes, carton, NO_CLEARANCE, Infinity)
    expect(first.backstopTripped).toBe(false)
    for (let run = 1; run < RUNS; run++) {
      expect(extremePointFit(boxes, carton, NO_CLEARANCE, Infinity)).toEqual(first)
    }
  })
})

describe('the reported void is as stable as the placements', () => {
  // ems.ts promises this in its own doc ("the determinism suite (phase 5) holds
  // the reported void to the same bar as placements") — here is the suite.
  const carton: Vec3 = [50, 50, 50]
  const clearances: Clearances = { betweenParts: 2.3, wall: 1.7 }

  it('emptyMaximalSpaces and largestFreeSpace are pure functions of the arrangement', () => {
    const result = pack(
      build({
        name: 'void',
        mode: 'fit-check',
        carton,
        clearances,
        parts: [
          ['a', [19.1, 23.7, 11.3]],
          ['b', [19.1, 23.7, 11.3]],
          ['c', [40, 40, 40]]
        ]
      })
    )
    if (result.mode !== 'fit-check') return
    expect(result.fits).toBe(false)
    expect(result.largestFreeSpace).toBeDefined()

    const spaces = emptyMaximalSpaces(result.placements, carton, clearances)
    for (let run = 1; run < RUNS; run++) {
      // Order included: the report picks the earliest of equal-volume spaces, so
      // a reshuffled list is a different reported triple.
      expect(emptyMaximalSpaces(result.placements, carton, clearances)).toEqual(spaces)
      expect(largestFreeSpace(result.placements, carton, clearances)).toEqual(
        result.largestFreeSpace
      )
    }
  })
})

describe('quantity refinement is stable', () => {
  it('refineQuantity returns the same arrangement every run', () => {
    const part = boxPart('domino', [20, 10, 10])
    const unit: PackBox = { name: part.name, weightG: 0, orientations: aabbOrientations(part) }
    const first = refineQuantity(unit, [30, 30, 30], NO_CLEARANCE, Infinity, 9, 13)
    expect(first?.count).toBe(13)
    for (let run = 1; run < RUNS; run++) {
      expect(refineQuantity(unit, [30, 30, 30], NO_CLEARANCE, Infinity, 9, 13)).toEqual(first)
    }
  })
})

describe('the audit, as a standing check', () => {
  // The other half of this slice is an audit for unstable orderings, and an audit
  // is a one-time act unless something holds its conclusion. Sets and Maps in
  // this directory are membership-only by review (extremePointFit's pointKeys,
  // ems's prune, validate's none) — that cannot be grepped honestly. A clock or
  // an unseeded PRNG can, and either would break determinism the moment it
  // appeared, silently and everywhere.
  const dir = join(__dirname, '..', 'src', 'renderer', 'src', 'core', 'packing')

  const BANNED = /Math\.random|Date\.now|performance\.now|new Date\(/

  /** Comments stripped, because these modules DISCUSS the rule they follow —
   *  extremePointFit's determinism note says "no Math.random" in prose, and a
   *  check that flagged it would have to be deleted the first time it ran. */
  const code = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('nothing in core/packing reads a clock or a random number', () => {
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => BANNED.test(code(readFileSync(join(dir, name), 'utf8'))))
    expect(offenders).toEqual([])
  })

  it('the check can fail (mutation-tested against both halves)', () => {
    expect(BANNED.test(code('const t = Date.now()'))).toBe(true)
    expect(BANNED.test(code('const r = Math.random()'))).toBe(true)
    // ...and the comment stripping does not blind it to real code on the line.
    expect(BANNED.test(code('const t = Date.now() // seeded elsewhere'))).toBe(true)
    expect(BANNED.test(code('// no Math.random here'))).toBe(false)
  })
})
