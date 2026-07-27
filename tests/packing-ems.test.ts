import { describe, expect, it } from 'vitest'
import { EPS } from '../src/renderer/src/core/geometry'
import {
  MAX_EMS_SPACES,
  emptyMaximalSpaces,
  largestFreeSpace
} from '../src/renderer/src/core/packing/ems'
import type { FreeSpace } from '../src/renderer/src/core/packing/ems'
import { extremePointFit } from '../src/renderer/src/core/packing/extremePointFit'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { pack } from '../src/renderer/src/core/packing/pack'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  OrientationOption,
  PackBox,
  PackPart,
  PackRequest,
  Placement,
  Vec3
} from '../src/renderer/src/core/packing/types'

// ems-bookkeeping (ADR-0022 phase 4). The fuzz suite guards PLACEMENTS; nothing
// there looks at voids, so a plausible-but-wrong "largest free space" would ship
// silently as misinformation (build plan §4 — the reason this slice carries an
// adversarial verify). The only oracle a reporting structure can have is its own
// properties, so this file pins them directly: every reported space is EMPTY
// (misses every gap-inflated box), MAXIMAL (every face pinned by a box or the
// window), and the set COVERS every free point — checked against hand-computed
// arrangements and against real engine output, where the checker shares no code
// with the difference process it judges.

const NO_GAPS: Clearances = { betweenParts: 0, wall: 0 }

const place = (min: Vec3, max: Vec3): Placement => ({
  partName: 'p',
  rotation: IDENTITY_MAT3,
  translation: min,
  boxMin: min,
  boxMax: max
})

const opt = (ex: number, ey: number, ez: number): OrientationOption => ({
  extent: [ex, ey, ez],
  rotation: IDENTITY_MAT3,
  rotatedMin: [0, 0, 0]
})

const box = (name: string, e: Vec3, weightG = 0): PackBox => ({
  name,
  weightG,
  orientations: [opt(e[0], e[1], e[2])]
})

const extentOf = (s: FreeSpace): Vec3 => [
  s.max[0] - s.min[0],
  s.max[1] - s.min[1],
  s.max[2] - s.min[2]
]

/** mulberry32 — the fuzz suite's PRNG: reproducible, no Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- the property checkers (independent of the difference process) ----------

interface Inflated {
  min: Vec3
  max: Vec3
}

function inflate(placements: readonly Placement[], gap: number): Inflated[] {
  return placements.map((p) => ({
    min: [p.boxMin[0] - gap, p.boxMin[1] - gap, p.boxMin[2] - gap],
    max: [p.boxMax[0] + gap, p.boxMax[1] + gap, p.boxMax[2] + gap]
  }))
}

/** Interpenetration depth of space and box beyond which emptiness is violated:
 *  positive separation ⇒ disjoint. The validator's separation metric. */
function separation(s: FreeSpace, b: Inflated): number {
  let best = -Infinity
  for (let a = 0; a < 3; a++) {
    const gap = Math.max(s.min[a] - b.max[a], b.min[a] - s.max[a])
    if (gap > best) best = gap
  }
  return best
}

/** Every space misses every inflated box (to EPS — the shared tolerance). */
function assertEmptiness(spaces: FreeSpace[], boxes: Inflated[]): void {
  for (const s of spaces) {
    for (const b of boxes) {
      expect(separation(s, b)).toBeGreaterThanOrEqual(-EPS)
    }
  }
}

/** Every face of every space is pinned: at the window, or against a box that
 *  overlaps the face's cross-section — so no space could grow in any direction,
 *  which is what "maximal" claims. Tolerance 2·EPS: the face may sit EPS from
 *  its pin, and the pin's own coordinate carries EPS. */
function assertMaximality(
  spaces: FreeSpace[],
  boxes: Inflated[],
  windowMin: Vec3,
  windowMax: Vec3
): void {
  for (const s of spaces) {
    for (let a = 0; a < 3; a++) {
      const [u, v] = [[1, 2], [0, 2], [0, 1]][a]
      const crossOverlaps = (b: Inflated): boolean =>
        b.min[u] < s.max[u] - EPS &&
        b.max[u] > s.min[u] + EPS &&
        b.min[v] < s.max[v] - EPS &&
        b.max[v] > s.min[v] + EPS
      const lowPinned =
        s.min[a] - windowMin[a] <= 2 * EPS ||
        boxes.some((b) => crossOverlaps(b) && Math.abs(b.max[a] - s.min[a]) <= 2 * EPS)
      const highPinned =
        windowMax[a] - s.max[a] <= 2 * EPS ||
        boxes.some((b) => crossOverlaps(b) && Math.abs(b.min[a] - s.max[a]) <= 2 * EPS)
      expect(lowPinned, `axis ${a} low face of ${JSON.stringify(s)} can grow`).toBe(true)
      expect(highPinned, `axis ${a} high face of ${JSON.stringify(s)} can grow`).toBe(true)
    }
  }
}

/** Every sampled free point lies in some space. Points are kept 2·EPS clear of
 *  boxes and window faces so the shared tolerance cannot excuse a miss. */
function assertCoverage(
  spaces: FreeSpace[],
  boxes: Inflated[],
  windowMin: Vec3,
  windowMax: Vec3,
  rnd: () => number,
  samples: number
): void {
  let checked = 0
  for (let i = 0; i < samples; i++) {
    const pt: Vec3 = [
      windowMin[0] + rnd() * (windowMax[0] - windowMin[0]),
      windowMin[1] + rnd() * (windowMax[1] - windowMin[1]),
      windowMin[2] + rnd() * (windowMax[2] - windowMin[2])
    ]
    const nearBox = boxes.some((b) => {
      for (let a = 0; a < 3; a++) {
        if (pt[a] <= b.min[a] + 2 * EPS || pt[a] >= b.max[a] - 2 * EPS) return false
      }
      return true
    })
    if (nearBox) continue
    checked++
    const covered = spaces.some((s) => {
      for (let a = 0; a < 3; a++) {
        if (pt[a] < s.min[a] - EPS || pt[a] > s.max[a] + EPS) return false
      }
      return true
    })
    expect(covered, `free point ${pt.join(', ')} is in no space`).toBe(true)
  }
  // The sampler must have actually exercised the property. A well-packed
  // carton leaves little free volume, so the floor is deliberately modest —
  // what matters is that it cannot silently drop to zero.
  expect(checked).toBeGreaterThan(samples / 10)
}

function assertProperties(
  placements: readonly Placement[],
  carton: Vec3,
  clearances: Clearances,
  seed: number
): FreeSpace[] {
  const spaces = emptyMaximalSpaces(placements, carton, clearances)
  expect(spaces).not.toBeNull()
  const gap = Math.max(0, clearances.betweenParts)
  const wall = Math.max(0, clearances.wall)
  const boxes = inflate(placements, gap)
  const windowMin: Vec3 = [wall, wall, wall]
  const windowMax: Vec3 = [carton[0] - wall, carton[1] - wall, carton[2] - wall]
  assertEmptiness(spaces!, boxes)
  assertMaximality(spaces!, boxes, windowMin, windowMax)
  assertCoverage(spaces!, boxes, windowMin, windowMax, prng(seed), 400)
  return spaces!
}

// --- hand-computed arrangements ---------------------------------------------

describe('emptyMaximalSpaces', () => {
  it('reports the whole window when nothing is placed', () => {
    const spaces = emptyMaximalSpaces([], [100, 80, 60], { betweenParts: 0, wall: 5 })
    expect(spaces).toEqual([{ min: [5, 5, 5], max: [95, 75, 55] }])
  })

  it('splits a corner box into the three classic overlapping slabs', () => {
    const spaces = emptyMaximalSpaces([place([0, 0, 0], [4, 4, 4])], [10, 10, 10], NO_GAPS)
    expect(spaces).toEqual([
      { min: [4, 0, 0], max: [10, 10, 10] },
      { min: [0, 4, 0], max: [10, 10, 10] },
      { min: [0, 0, 4], max: [10, 10, 10] }
    ])
  })

  it('a box in the middle leaves all six maximal slabs', () => {
    const spaces = emptyMaximalSpaces([place([4, 4, 4], [6, 6, 6])], [10, 10, 10], NO_GAPS)
    expect(spaces).toHaveLength(6)
    // Every slab spans the full carton on its two free axes — that spanning is
    // what maximality means here.
    for (const s of spaces!) {
      const dims = [...extentOf(s)].sort((a, b) => b - a)
      expect(dims).toEqual([10, 10, 4])
    }
  })

  it('shrinks spaces by the between-parts gap (usable-by-a-part semantics)', () => {
    // Box 0..4 with a 1 mm gap: the space beside it starts at 5, not 4 — a part
    // with x-extent 5 placed there honors the gap exactly.
    const spaces = emptyMaximalSpaces(
      [place([0, 0, 0], [4, 10, 10])],
      [10, 10, 10],
      { betweenParts: 1, wall: 0 }
    )
    expect(spaces).toEqual([{ min: [5, 0, 0], max: [10, 10, 10] }])
  })

  it('confines spaces to the wall-clearance window', () => {
    const spaces = emptyMaximalSpaces(
      [place([1, 1, 1], [5, 11, 11])],
      [12, 12, 12],
      { betweenParts: 0, wall: 1 }
    )
    expect(spaces).toEqual([{ min: [5, 1, 1], max: [11, 11, 11] }])
  })

  it('two stacked boxes: the survivor is the corner the engines abandoned', () => {
    // Bottom slab fills z 0..4; a second box fills the left half above it. The
    // one remaining maximal space is the right half of the upper region.
    const spaces = emptyMaximalSpaces(
      [place([0, 0, 0], [10, 10, 4]), place([0, 0, 4], [5, 10, 10])],
      [10, 10, 10],
      NO_GAPS
    )
    expect(spaces).toEqual([{ min: [5, 0, 4], max: [10, 10, 10] }])
  })

  it('a full carton has no spaces; a touching box splits nothing', () => {
    expect(emptyMaximalSpaces([place([0, 0, 0], [10, 10, 10])], [10, 10, 10], NO_GAPS)).toEqual([])
    // A box whose face exactly meets a region's face splits nothing there: the
    // full lower space survives whole (touching is not overlapping).
    const spaces = emptyMaximalSpaces(
      [place([0, 0, 10], [10, 10, 14])],
      [10, 10, 14],
      { betweenParts: 0, wall: 0 }
    )
    expect(spaces).toContainEqual({ min: [0, 0, 0], max: [10, 10, 10] })
  })

  it('returns [] for a window with no room, null for boxes it cannot reason about', () => {
    expect(emptyMaximalSpaces([], [10, 10, 6], { betweenParts: 0, wall: 3 })).toEqual([])
    expect(
      emptyMaximalSpaces([place([0, 0, 0], [NaN, 4, 4])], [10, 10, 10], NO_GAPS)
    ).toBeNull()
    expect(emptyMaximalSpaces([], [10, Infinity, 10], NO_GAPS)).toBeNull()
  })

  it('refuses an inverted box (adversarial-verify refutation): null, never the part interior as void', () => {
    // An inverted box's crosswise min/max make a split's two residuals overlap
    // across the part's own occupied region — the executed counterexample
    // reported a 60-wide largest space where truth was 40, with 10 mm of
    // space-into-part interpenetration. The validator calls this box
    // degenerate; this module must refuse it the same way.
    expect(
      emptyMaximalSpaces([place([60, 0, 0], [40, 10, 10])], [100, 10, 10], NO_GAPS)
    ).toBeNull()
    expect(largestFreeSpace([place([60, 0, 0], [40, 10, 10])], [100, 10, 10], NO_GAPS)).toBeNull()
    // Inversion within EPS is float noise on a flat part, not degeneracy.
    expect(
      emptyMaximalSpaces([place([4, 0, 0], [4 - EPS / 2, 10, 10])], [10, 10, 10], NO_GAPS)
    ).not.toBeNull()
  })

  it('shaves a space for a box penetrating EPS + one ulp (the additive-tolerance window)', () => {
    // Adversarial-verify refutation: with the disjoint test written as
    // `bmax <= s.min + EPS`, fl(4 + EPS) rounds UP, so a sliver penetrating the
    // space by EPS + 1.4e-16 was called disjoint and the space claimed the
    // overlap as free — on a validator-clean arrangement. The subtraction shape
    // (validate.ts's arithmetic) must shave it.
    const v = 4
    const w = 4 + EPS // fl(4 + 1e-6): sits just OVER v + EPS in float
    expect(w - v).toBeGreaterThan(EPS) // the premise the window lives on
    const A = place([0, 0, 0], [v, 10, 10])
    const B = place([6, 0, 0], [8, 10, 10])
    const C = place([v, 0, 0], [w, 10, 10]) // EPS-thin sliver on A's face
    const carton: Vec3 = [8, 10, 10]
    expect(validatePlacements([A, B, C], carton, { clearances: NO_GAPS })).toEqual([])
    const spaces = emptyMaximalSpaces([A, B, C], carton, NO_GAPS)
    // The gap between A and B survives only beyond the sliver.
    expect(spaces).toEqual([{ min: [w, 0, 0], max: [6, 10, 10] }])
  })

  it('sanitizes garbage clearances to zero, like the engines', () => {
    const spaces = emptyMaximalSpaces(
      [place([0, 0, 0], [4, 10, 10])],
      [10, 10, 10],
      { betweenParts: NaN, wall: -5 }
    )
    expect(spaces).toEqual([{ min: [4, 0, 0], max: [10, 10, 10] }])
  })

  it('bails to null past MAX_EMS_SPACES rather than dropping spaces', () => {
    // A diagonal of small cubes fragments space combinatorially: each box can
    // triple the live set. 40 boxes overwhelm the cap if it is enforced.
    const placements: Placement[] = []
    for (let i = 0; i < 40; i++) {
      const t = i * 2
      placements.push(place([t, t, t], [t + 1, t + 1, t + 1]))
    }
    const spaces = emptyMaximalSpaces(placements, [80, 80, 80], NO_GAPS)
    // Either the process stayed under the cap (fine) or it refused — it must
    // never return a truncated list.
    if (spaces !== null) {
      expect(spaces.length).toBeLessThanOrEqual(MAX_EMS_SPACES)
      assertEmptiness(spaces, inflate(placements, 0))
    }
  })
})

// --- the properties, against real engine output ------------------------------

describe('EMS properties over engine arrangements', () => {
  it('holds for an extreme-point non-fit, with clearances', () => {
    const carton: Vec3 = [60, 50, 40]
    const clearances: Clearances = { betweenParts: 2, wall: 3 }
    const rnd = prng(0x5eed4001)
    const boxes: PackBox[] = []
    for (let i = 0; i < 24; i++) {
      const e: Vec3 = [6 + rnd() * 24, 6 + rnd() * 20, 6 + rnd() * 16]
      boxes.push(box(`p${i}`, e))
    }
    const fit = extremePointFit(boxes, carton, clearances, Infinity)
    expect(fit.unplaced.length).toBeGreaterThan(0) // else the case proves nothing
    assertProperties(fit.placements, carton, clearances, 0x5eed4002)
  })

  it('holds for a shelf arrangement — the raced winner may be shelf', () => {
    const carton: Vec3 = [50, 50, 30]
    const rnd = prng(0x5eed4003)
    const boxes: PackBox[] = []
    for (let i = 0; i < 10; i++) {
      const e: Vec3 = [3 + rnd() * 20, 3 + rnd() * 20, 3 + rnd() * 12]
      boxes.push(box(`s${i}`, e))
    }
    const fit = greedyShelfFit(boxes, carton, NO_GAPS, Infinity)
    expect(fit.placements.length).toBeGreaterThan(3)
    assertProperties(fit.placements, carton, NO_GAPS, 0x5eed4004)
  })

  it('is deterministic: identical space lists on repeated runs', () => {
    const carton: Vec3 = [60, 50, 40]
    const clearances: Clearances = { betweenParts: 1, wall: 2 }
    const rnd = prng(0x5eed4005)
    const boxes: PackBox[] = []
    for (let i = 0; i < 12; i++) {
      boxes.push(box(`d${i}`, [3 + rnd() * 15, 3 + rnd() * 15, 3 + rnd() * 10]))
    }
    const fit = extremePointFit(boxes, carton, clearances, Infinity)
    const a = emptyMaximalSpaces(fit.placements, carton, clearances)
    const b = emptyMaximalSpaces(fit.placements, carton, clearances)
    expect(a).toEqual(b)
    expect(largestFreeSpace(fit.placements, carton, clearances)).toEqual(
      largestFreeSpace(fit.placements, carton, clearances)
    )
  })
})

// --- largestFreeSpace and the pack() wiring ----------------------------------

/** 8-corner axis-aligned box part (the orchestrator tests' builder). */
function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
  const pts: number[][] = []
  for (const x of [0, size[0]])
    for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
  const positions = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => positions.set(p, i * 3))
  return { name, positions, weightG }
}

describe('largestFreeSpace', () => {
  it('picks by volume, hand-computed', () => {
    // Bottom slab z 0..4 plus left half above: largest space is 5×10×6 = 300.
    const dims = largestFreeSpace(
      [place([0, 0, 0], [10, 10, 4]), place([0, 0, 4], [5, 10, 10])],
      [10, 10, 10],
      NO_GAPS
    )
    expect(dims).toEqual([5, 10, 6])
  })

  it('breaks volume ties deterministically (first of the equal slabs)', () => {
    const dims = largestFreeSpace([place([0, 0, 0], [4, 4, 4])], [10, 10, 10], NO_GAPS)
    expect(dims).toEqual([6, 10, 10])
  })

  it('returns null when there is nothing to report', () => {
    expect(largestFreeSpace([place([0, 0, 0], [10, 10, 10])], [10, 10, 10], NO_GAPS)).toBeNull()
    expect(
      largestFreeSpace([place([0, 0, 0], [NaN, 4, 4])], [10, 10, 10], NO_GAPS)
    ).toBeNull()
  })
})

describe('pack() carries the void on a non-fit', () => {
  const request = (parts: PackPart[], carton: Vec3, maxWeightG = Infinity): PackRequest => ({
    mode: 'fit-check',
    tier: 'fast',
    carton,
    clearances: NO_GAPS,
    maxWeightG,
    parts
  })

  it('non-fit: largestFreeSpace present and honest against the placements', () => {
    // Two 6-cubes cannot share a 10-carton axis; one is placed, one is not.
    const result = pack(request([boxPart('a', [6, 6, 6]), boxPart('b', [6, 6, 6])], [10, 10, 7]))
    expect(result.mode).toBe('fit-check')
    if (result.mode !== 'fit-check') return
    expect(result.fits).toBe(false)
    // One 6×6×6 in the corner of 10×10×7: largest slab is 4×10×7 = 280.
    expect(result.largestFreeSpace).toEqual([4, 10, 7])
  })

  it('fit: the field is absent — §7 only speaks on a non-fit', () => {
    const result = pack(request([boxPart('a', [6, 6, 6])], [10, 10, 7]))
    expect(result.mode).toBe('fit-check')
    if (result.mode !== 'fit-check') return
    expect(result.fits).toBe(true)
    expect(result.largestFreeSpace).toBeUndefined()
  })

  it('weight-bound non-fit still reports the space (presentation gates, not data)', () => {
    const result = pack(
      request([boxPart('a', [6, 6, 6], 500), boxPart('b', [2, 2, 2], 600)], [10, 10, 7], 800)
    )
    if (result.mode !== 'fit-check') return
    expect(result.fits).toBe(false)
    expect(result.binding).toBe('weight')
    expect(result.largestFreeSpace).toBeDefined()
  })
})
