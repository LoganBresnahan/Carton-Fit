import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import occtFactory, { type OcctModule } from 'occt-import-js'
import { extractParts } from '../src/renderer/src/workers/occt/occt-to-parts'
import {
  DEFAULT_EP_SCORING,
  extremePointFit
} from '../src/renderer/src/core/packing/extremePointFit'
import type { EpScoringRule } from '../src/renderer/src/core/packing/extremePointFit'
import { aabbOrientations } from '../src/renderer/src/core/packing/orientations'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { beatsIncumbent } from '../src/renderer/src/core/packing/pack'
import { validatePlacements } from '../src/renderer/src/core/packing/validate'
import { EPS } from '../src/renderer/src/core/geometry'
import { IDENTITY_MAT3 } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  FitPlacement,
  OrientationOption,
  PackBox,
  Vec3
} from '../src/renderer/src/core/packing/types'

// The differential oracle (ADR-0022 §2, build plan phase 3). The repo's first
// generative suite, and it exists because the goldens cannot cover what this
// engine does wrong: extreme-point placement is the first code in core/packing
// that CAN interpenetrate, and a wrong arrangement renders as confidently as a
// right one. Hand-written cases test the geometry someone thought of.
//
// THE TWO ENGINES ARE NOT PEERS. Greedy shelf is correct by construction — cursor
// arithmetic, no collision test to be wrong — so it is the control, and every
// generated load is answered by both. The judge is the phase-1 validator
// (validate.ts), which shares no reasoning with either.
//
// WHAT IS AN INVARIANT AND WHAT IS A STATISTIC — the distinction phase 2's
// adversarial verify forced, and the reason this file is shaped the way it is:
//
//   INVARIANT   every EP placement is physically real and honors the clearances
//   INVARIANT   the RACED answer is never worse than shelf's (pack.ts's ratchet)
//   INVARIANT   no engine exceeds the weight cap
//   INVARIANT   same input, same output, every run
//   STATISTIC   raw EP beating shelf. It does NOT always: on roughly 1 in 300
//               seeded inputs, under either scoring rule, a greedy shelf packs
//               more than extreme points do — the corner-and-projection search is
//               not a superset of the shelf's layer discipline. That is precisely
//               why ADR-0022 §2 keeps shelf as the incumbent rather than replacing
//               it, and why the ≥ invariant is asserted against the raced result
//               (which dominates by construction) and not against raw EP. Tracked
//               here with a ceiling, so a regression that makes EP broadly worse
//               still fails, while the honest tail does not turn the suite red.
//
// Every number below is reproducible: one seeded PRNG, no Math.random, no clock.

/** mulberry32 — small, fast, well-distributed, and above all REPRODUCIBLE. A
 *  fuzz suite that cannot reproduce its own failure is a flake generator. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const opt = (ex: number, ey: number, ez: number): OrientationOption => ({
  extent: [ex, ey, ez],
  rotation: IDENTITY_MAT3,
  rotatedMin: [0, 0, 0]
})

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

interface Case {
  boxes: PackBox[]
  carton: Vec3
  clearances: Clearances
  maxWeightG: number
  /** Which generator produced it — named in failure messages so a red run points
   *  at the shape of load that broke, not just a seed. */
  shape: string
}

/**
 * The generators. Each targets a different way the two engines can disagree:
 *
 *  - `mixed`      ordinary heterogeneous parts, room to spare.
 *  - `heights`    flat slabs interleaved with tall blocks. THE shelf weakness: a
 *                 shelf's depth is the tallest thing in it, so the air above every
 *                 shorter part is abandoned. This is where EP should win.
 *  - `tight`      carton volume barely above the parts' total, so nearly every
 *                 candidate is tested against nearly every placed box, and the
 *                 EPS boundaries in both engines are under load.
 *  - `degenerate` zero-thickness and hair-thin extents, huge aspect ratios — the
 *                 inputs where a tolerant comparison can quietly admit an
 *                 arrangement the validator calls impossible.
 *  - `gapped`     nonzero wall and between-parts clearances, which the two engines
 *                 implement by completely different means (usable-window shrink vs
 *                 pairwise separation) and must still agree about.
 *  - `capped`     a weight cap that bites partway through, so the geometry search
 *                 and the cap interleave.
 */
function generate(rnd: () => number, shape: string): Case {
  const n = 3 + Math.floor(rnd() * 14)
  const dims: Vec3[] = []
  const pick = (lo: number, hi: number): number => lo + Math.round(rnd() * (hi - lo))

  for (let i = 0; i < n; i++) {
    if (shape === 'heights') {
      dims.push(rnd() < 0.5 ? [pick(20, 60), pick(20, 60), pick(1, 6)] : [pick(10, 30), pick(10, 30), pick(30, 70)])
    } else if (shape === 'degenerate') {
      const thin = rnd() < 0.3 ? 0 : rnd() < 0.5 ? 1e-3 : pick(1, 3)
      const axis = Math.floor(rnd() * 3)
      const d: [number, number, number] = [pick(5, 60), pick(5, 60), pick(5, 60)]
      d[axis] = thin
      dims.push(d)
    } else {
      dims.push([pick(5, 50), pick(5, 50), pick(5, 50)])
    }
  }

  const totalVolume = dims.reduce((s, d) => s + d[0] * d[1] * d[2], 0)
  const side =
    shape === 'tight'
      ? Math.cbrt(totalVolume * (1.05 + rnd() * 0.35))
      : Math.cbrt(totalVolume * (1.5 + rnd() * 2.5))
  const carton: Vec3 = [side * (0.8 + rnd() * 0.4), side * (0.8 + rnd() * 0.4), side * (0.8 + rnd() * 0.4)]

  const clearances: Clearances =
    shape === 'gapped'
      ? { betweenParts: rnd() * 3, wall: rnd() * 3 }
      : { betweenParts: 0, wall: 0 }

  const weightEach = 100
  const maxWeightG = shape === 'capped' ? weightEach * (1 + Math.floor(rnd() * n)) : Infinity

  return {
    boxes: dims.map((d, i) => ({
      name: `p${i}`,
      weightG: shape === 'capped' ? weightEach : 0,
      orientations: perms(d)
    })),
    carton,
    clearances,
    maxWeightG,
    shape
  }
}

const SHAPES = ['mixed', 'heights', 'tight', 'degenerate', 'gapped', 'capped'] as const
/** 40 cases per shape. Enough for the 1-in-300 tail to show up across the corpus
 *  without making a suite that runs twice on every ship pay for it. */
const PER_SHAPE = 40

function corpus(seed: number): Case[] {
  const rnd = prng(seed)
  const cases: Case[] = []
  for (const shape of SHAPES) {
    for (let i = 0; i < PER_SHAPE; i++) cases.push(generate(rnd, shape))
  }
  return cases
}

function placedWeight(fit: FitPlacement, boxes: readonly PackBox[]): number {
  const byName = new Map(boxes.map((b) => [b.name, b.weightG]))
  return fit.placements.reduce((s, p) => s + (byName.get(p.partName) ?? 0), 0)
}

function run(c: Case, scoring: EpScoringRule): FitPlacement {
  return extremePointFit(c.boxes, c.carton, c.clearances, c.maxWeightG, { scoring })
}

describe('differential fuzz: extreme-point against the shelf oracle', () => {
  const cases = corpus(0x5eed_2022)

  it('every extreme-point arrangement is physically real and honors the gaps', () => {
    for (const [i, c] of cases.entries()) {
      for (const scoring of ['deepest-bottom-left', 'best-fit-volume'] as const) {
        const ep = run(c, scoring)
        const violations = validatePlacements(ep.placements, c.carton, {
          clearances: c.clearances
        })
        expect(violations, `case ${i} (${c.shape}, ${scoring}): ${violations[0]?.detail}`).toEqual(
          []
        )
      }
    }
  })

  it('the raced answer is never worse than the incumbent alone', () => {
    // The ratchet, on generated input. Asserted against the RACE, not raw EP —
    // raw EP genuinely loses sometimes (see the statistic below), and pack.ts's
    // comparator is what turns "usually better" into "never worse".
    for (const [i, c] of cases.entries()) {
      const shelf = greedyShelfFit(c.boxes, c.carton, c.clearances, c.maxWeightG)
      const ep = run(c, 'deepest-bottom-left')
      const raced = beatsIncumbent(ep, shelf) ? ep : shelf
      expect(raced.unplaced.length, `case ${i} (${c.shape})`).toBeLessThanOrEqual(
        shelf.unplaced.length
      )
      expect(validatePlacements(raced.placements, c.carton, { clearances: c.clearances })).toEqual(
        []
      )
    }
  })

  it('no engine ever exceeds the weight cap', () => {
    for (const [i, c] of cases.entries()) {
      if (!Number.isFinite(c.maxWeightG)) continue
      for (const fit of [
        greedyShelfFit(c.boxes, c.carton, c.clearances, c.maxWeightG),
        run(c, 'deepest-bottom-left'),
        run(c, 'best-fit-volume')
      ]) {
        expect(placedWeight(fit, c.boxes), `case ${i} (${c.shape})`).toBeLessThanOrEqual(
          c.maxWeightG + EPS
        )
      }
    }
  })

  it('is deterministic across repeated runs of the same case', () => {
    for (const c of cases.slice(0, 40)) {
      const a = run(c, 'deepest-bottom-left')
      const b = run(c, 'deepest-bottom-left')
      expect(b.placements).toEqual(a.placements)
      expect(b.unplaced).toEqual(a.unplaced)
      expect(b.binding).toBe(a.binding)
    }
  })

  it('earns its place: extreme-point beats shelf on a third of the corpus', () => {
    // The statistic, in the direction that matters. Every invariant above would
    // still pass if EP quietly degraded into a worse shelf — the race would hide
    // it perfectly, and the app would just stop getting better answers. This is
    // the assertion that notices.
    //
    // Measured on this corpus (seed 0x5eed2022, 240 cases): EP places MORE than
    // shelf in 80, fewer in 0, the same in 160. By generator, the wins concentrate
    // exactly where the ADR predicted — tight cartons 31/40, clearance-laden
    // 18/40, mixed heights 16/40, ordinary mixed 14/40 — and vanish where geometry
    // is not the question: weight-capped 1/40, and hair-thin parts 0/40, where
    // everything fits either way.
    let epBetter = 0
    let shelfBetter = 0
    for (const c of cases) {
      const shelf = greedyShelfFit(c.boxes, c.carton, c.clearances, c.maxWeightG)
      const ep = run(c, 'deepest-bottom-left')
      if (ep.placements.length > shelf.placements.length) epBetter++
      else if (ep.placements.length < shelf.placements.length) shelfBetter++
    }
    expect(epBetter / cases.length).toBeGreaterThan(0.25)
    // And the honest tail, as a CEILING rather than an invariant: raw EP is not a
    // superset of the shelf's layer discipline and does lose occasionally (~1 in
    // 300 across a 3000-case sweep; 0 in this corpus). A ceiling catches a
    // regression that makes it broadly worse without making the tail flaky-red.
    expect(shelfBetter / cases.length).toBeLessThan(0.02)
  })
})

describe('the scoring rule, settled by measurement (ADR-0022 "Open at build time")', () => {
  // ADR-0022 left the scoring rule open ON PURPOSE, to be decided by this suite
  // rather than by argument, and the engine carries both behind a switch so
  // settling it reopens nothing that was verified. The measurement, run 2026-07-27:
  //
  //   3000-case sweep   deepest-bottom-left  20910 parts placed, 4.0294e8 mm³
  //                     best-fit-volume      20901 parts placed, 4.0272e8 mm³
  //                     head to head         dbl ahead in 98, bfv in 89, level 2813
  //                     losses to shelf      dbl 3, bfv 4
  //   AS1 assembly      identical at every carton size from 610 mm down to 160 mm,
  //                     including the two sizes where parts start not fitting
  //
  // So: statistically level, with deepest-bottom-left a hair ahead on every axis
  // and indistinguishable on the one real assembly we have. The tiebreak is cost —
  // deepest-bottom-left compares three coordinates, best-fit-volume builds and
  // sorts an envelope volume for every candidate. Settled on deepest-bottom-left.
  // The loser stays behind the switch (it is tested, and quantity refinement may
  // want to revisit it), which keeps changing our mind a one-line change.

  const cases = corpus(0x5eed_2022)

  it('ships deepest-bottom-left', () => {
    expect(DEFAULT_EP_SCORING).toBe('deepest-bottom-left')
  })

  it('neither rule dominates the other — which is why cost decided it', () => {
    let dbl = 0
    let bfv = 0
    for (const c of corpus(0x5eed_2022)) {
      const a = run(c, 'deepest-bottom-left').placements.length
      const b = run(c, 'best-fit-volume').placements.length
      if (a > b) dbl++
      else if (b > a) bfv++
    }
    // Measured 8 and 5 of 240. The assertion is the SHAPE of that result — both
    // rules win sometimes, and neither by much — because a rule that had turned
    // out to dominate would deserve the switch removed, not this comment.
    expect(dbl).toBeGreaterThan(0)
    expect(bfv).toBeGreaterThan(0)
    expect(Math.abs(dbl - bfv) / cases.length).toBeLessThan(0.05)
  })
})

describe('the scoring rule on real parts', () => {
  let occt: OcctModule
  beforeAll(async () => {
    occt = await occtFactory()
  }, 60_000)

  it('is indistinguishable on the AS1 assembly, right down to where parts stop fitting', () => {
    // The generated corpus is where the two rules differ at all; the one real
    // assembly in samples/ is where it turns out not to matter. Worth asserting
    // rather than only recording, because "the rule we settled on does not lose on
    // real parts" is the claim the settlement rests on — and the small cartons at
    // the end of this ladder are where a rule could start dropping parts.
    const result = occt.ReadStepFile(
      new Uint8Array(readFileSync(join(__dirname, '..', 'samples', 'as1-oc-214.stp'))),
      { linearUnit: 'millimeter' }
    )
    const boxes: PackBox[] = extractParts(result).map((p) => ({
      name: p.name,
      weightG: 0,
      orientations: aabbOrientations({ name: p.name, positions: p.positions, weightG: 0 })
    }))
    const NONE: Clearances = { betweenParts: 0, wall: 0 }
    for (const side of [610, 400, 300, 220, 180, 160]) {
      const carton: Vec3 = [side, side, side]
      const dbl = extremePointFit(boxes, carton, NONE, Infinity, {
        scoring: 'deepest-bottom-left'
      })
      const bfv = extremePointFit(boxes, carton, NONE, Infinity, { scoring: 'best-fit-volume' })
      expect(bfv.placements.length, `carton ${side}`).toBe(dbl.placements.length)
      expect(validatePlacements(dbl.placements, carton), `carton ${side}`).toEqual([])
      expect(validatePlacements(bfv.placements, carton), `carton ${side}`).toEqual([])
    }
  })
})
