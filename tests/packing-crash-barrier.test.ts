import { describe, expect, it } from 'vitest'
import {
  pack,
  racedFit,
  refineWithBarrier,
  type FitChallenger,
  type QuantityChallenger
} from '../src/renderer/src/core/packing/pack'
import { extremePointFit } from '../src/renderer/src/core/packing/extremePointFit'
import type { EpFitPlacement } from '../src/renderer/src/core/packing/extremePointFit'
import { aabbOrientations } from '../src/renderer/src/core/packing/orientations'
import { greedyShelfFit } from '../src/renderer/src/core/packing/shelfFit'
import { IDENTITY_MAT3, sanitizeClearances } from '../src/renderer/src/core/packing/types'
import type {
  Clearances,
  PackBox,
  PackPart,
  PackRequest,
  Placement,
  Vec3
} from '../src/renderer/src/core/packing/types'
import type { QuantityRefinement } from '../src/renderer/src/core/packing/quantityRefine'

// crash-barrier-wrapper (ADR-0022 §2, build-plan phase 5). Three triggers, one
// response: the incumbent's answer stands, which is what the app answered before
// this ADR existed.
//
// TESTING IT MEANS BUILDING A BROKEN CHALLENGER. The real extreme-point engine
// does not throw, does not overlap, and does not trip on anything a carton holds
// — the differential fuzz is what keeps that true. So the barrier can only be
// exercised through its challenger seam, with an engine written to fire each
// trigger exactly once. A barrier tested only against the working engine is a
// barrier tested only for the case where it does nothing.
//
// Each trigger is checked twice: that the incumbent's arrangement is what comes
// back, AND that the barrier is what caused it (the same challenger without the
// defect wins the race). Otherwise a barrier that discarded EVERY challenger
// would pass all three.

const NO_CLEARANCE: Clearances = { betweenParts: 0, wall: 0 }

/** 8-corner axis-aligned box, the same fixture shape the other packing suites use. */
function boxPart(name: string, size: Vec3, weightG = 0): PackPart {
  const pts: number[][] = []
  for (const x of [0, size[0]]) for (const y of [0, size[1]]) for (const z of [0, size[2]]) pts.push([x, y, z])
  const positions = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => positions.set(p, i * 3))
  return { name, positions, weightG }
}

function packBox(name: string, size: Vec3, weightG = 0): PackBox {
  const part = boxPart(name, size, weightG)
  return { name, weightG, orientations: aabbOrientations(part) }
}

/** The shelf blind spot from phase 3's orchestrator suite, reused deliberately:
 *  the load where the shelf cursor abandons 40 mm of air above the first slab and
 *  extreme-point drops `b` straight into it. The whole file depends on the
 *  challenger being able to WIN when it is healthy — otherwise "the incumbent's
 *  answer came back" proves nothing — so that is asserted first, not assumed. */
const CARTON: Vec3 = [50, 50, 50]
const SHELF_BLIND_SPOT: readonly (readonly [string, Vec3])[] = [
  ['a', [10, 40, 50]],
  ['b', [20, 30, 20]],
  ['c', [10, 40, 40]]
]
const LOAD: PackBox[] = SHELF_BLIND_SPOT.map(([name, size]) => packBox(name, size))

describe('racedFit — the challenger wins when it is healthy', () => {
  it('extreme-point beats the shelf on the regression load', () => {
    const shelf = greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    const raced = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    expect(shelf.unplaced).toEqual(['b'])
    expect(raced.unplaced).toEqual([])
    expect(raced.placements).toHaveLength(3)
  })
})

describe('racedFit — trigger 1: the challenger throws', () => {
  const throwing: FitChallenger = () => {
    throw new Error('synthetic engine defect')
  }

  it('returns the incumbent instead of propagating the throw', () => {
    const shelf = greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    const raced = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, throwing)
    expect(raced).toEqual(shelf)
  })

  it('a pack() whose challenger throws still answers, with the shelf answer', () => {
    // The user-visible guarantee: not "an error occurred", but the estimate the
    // app gave before ADR-0022. pack() is total (no throw) by contract.
    const request: PackRequest = {
      mode: 'fit-check',
      tier: 'fast',
      carton: CARTON,
      clearances: NO_CLEARANCE,
      maxWeightG: Infinity,
      parts: SHELF_BLIND_SPOT.map(([name, size]) => boxPart(name, size))
    }
    const healthy = pack(request)
    expect(healthy.mode).toBe('fit-check')
    if (healthy.mode !== 'fit-check') return
    expect(healthy.fits).toBe(true)

    // Same request, with the engine broken at the seam: an answer, not an error —
    // and specifically the pre-ADR-0022 answer.
    const shelfOnly = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, throwing)
    expect(shelfOnly.unplaced).toEqual(['b'])
  })
})

describe('racedFit — trigger 2: the challenger returns an invalid arrangement', () => {
  /** Places everything, overlapping — the failure the validator exists for, and
   *  the one that would otherwise WIN the race (fewest unplaced) and ship. */
  const overlapping: FitChallenger = (boxes) => ({
    placements: boxes.map((box): Placement => {
      const extent = box.orientations[0].extent
      return {
        partName: box.name,
        rotation: IDENTITY_MAT3,
        translation: [0, 0, 0],
        boxMin: [0, 0, 0],
        boxMax: [extent[0], extent[1], extent[2]]
      }
    }),
    unplaced: [],
    binding: 'geometry',
    ops: 1,
    backstopTripped: false
  })

  it('discards it and returns the incumbent', () => {
    const shelf = greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    const raced = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, overlapping)
    expect(raced).toEqual(shelf)
    // Proof the discard is what happened: unchecked, this challenger would have
    // won outright.
    expect(overlapping(LOAD, CARTON, NO_CLEARANCE, Infinity).unplaced).toEqual([])
  })

  it('discards an arrangement that leaves the carton', () => {
    // Placed WELL APART and all three placed, so the only thing wrong with this
    // arrangement is that one box pokes out of the box. Written to win the race
    // (nothing unplaced) — otherwise the spec would pass on the strength of
    // beatsIncumbent and prove nothing about the barrier. Mutation-checked: this
    // is the shape that fails when the validator call is deleted.
    const escaping: FitChallenger = (boxes) => ({
      placements: boxes.map((box, i) => ({
        partName: box.name,
        rotation: IDENTITY_MAT3,
        translation: [0, 0, 0],
        boxMin: [i === 2 ? CARTON[0] + 5 : i * 12, 0, 0],
        boxMax: [(i === 2 ? CARTON[0] + 5 : i * 12) + 5, 5, 5]
      })),
      unplaced: [],
      binding: 'geometry',
      ops: 1,
      backstopTripped: false
    })
    expect(escaping(LOAD, CARTON, NO_CLEARANCE, Infinity).unplaced).toEqual([]) // would win
    expect(racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, escaping)).toEqual(
      greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    )
  })

  it('discards an arrangement that eats the clearance the user asked for', () => {
    // Not physically impossible — just a broken promise about dunnage. The
    // barrier is strict about it anyway, because the incumbent honors the gap by
    // construction and is free (see racedFit's doc).
    //
    // The 45 mm gap is what makes this a real test: shelf cannot place both cubes
    // (10 + 45 + 10 = 65 > 50), so the challenger's touching pair WOULD win the
    // race outright. Only the validator stops it.
    const clearances: Clearances = { betweenParts: 45, wall: 0 }
    const touching: FitChallenger = (boxes) => ({
      placements: boxes.map((box, i) => ({
        partName: box.name,
        rotation: IDENTITY_MAT3,
        translation: [i * 10, 0, 0],
        boxMin: [i * 10, 0, 0],
        boxMax: [i * 10 + 10, 10, 10]
      })),
      unplaced: [],
      binding: 'geometry',
      ops: 1,
      backstopTripped: false
    })
    const boxes = [packBox('a', [10, 10, 10]), packBox('b', [10, 10, 10])]
    const shelf = greedyShelfFit(boxes, CARTON, clearances, Infinity)
    expect(shelf.unplaced).toEqual(['b']) // the incumbent genuinely cannot do better
    expect(racedFit(boxes, CARTON, clearances, Infinity, touching)).toEqual(shelf)
  })

  it('judges with SANITIZED clearances, so a nonsense gap cannot discard a good answer', () => {
    // A negative or NaN gap reaches this seam through the public Clearances type.
    // Every engine clamps it to zero; if the judge did not, it would either
    // demand a negative gap (harmless) or compare against NaN (silently stops
    // rejecting) — and the barrier would be asking a different question than the
    // engine was asked. The healthy challenger must still win.
    // Infinity is the case that actually bites, and it bites SILENTLY: every
    // engine treats a non-finite gap as no gap and packs normally, while an
    // unsanitized judge demands infinite clearance, finds a violation in every
    // arrangement, and discards the challenger on every single pack. Nothing
    // would look broken — the app would just quietly stop being ADR-0022.
    for (const clearances of [
      { betweenParts: -5, wall: -5 },
      { betweenParts: Number.NaN, wall: Number.NaN },
      { betweenParts: Number.POSITIVE_INFINITY, wall: Number.POSITIVE_INFINITY }
    ] satisfies Clearances[]) {
      expect(sanitizeClearances(clearances)).toEqual({ betweenParts: 0, wall: 0 })
      const raced = racedFit(LOAD, CARTON, clearances, Infinity)
      expect(raced.unplaced).toEqual([])
    }
  })
})

describe('racedFit — trigger 3: the challenger trips the operation backstop', () => {
  it('discards a tripped result even when it placed more than the incumbent', () => {
    // The cost of §2's rule, made explicit: this challenger's truncated
    // arrangement is VALID and strictly better, and it is still thrown away,
    // because a partial search is an answer that depends on where the budget ran
    // out. A trip needs a part count no realistic carton has.
    const trippedButBetter: FitChallenger = (boxes, carton, clearances, maxWeightG) => {
      const good = extremePointFit(boxes, carton, clearances, maxWeightG)
      return { ...good, backstopTripped: true }
    }
    const shelf = greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    const raced = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, trippedButBetter)
    expect(raced).toEqual(shelf)
    // ...and the identical result without the trip flag wins, so the flag is
    // what caused the discard.
    expect(racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, extremePointFit).unplaced).toEqual([])
  })

  it('the real engine under a tiny budget falls back to the incumbent', () => {
    const starved: FitChallenger = (boxes, carton, clearances, maxWeightG) =>
      extremePointFit(boxes, carton, clearances, maxWeightG, { maxOps: 1 })
    const probe = starved(LOAD, CARTON, NO_CLEARANCE, Infinity)
    expect(probe.backstopTripped).toBe(true)
    expect(racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity, starved)).toEqual(
      greedyShelfFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    )
  })
})

describe('refineWithBarrier — quantity mode', () => {
  const unit = packBox('cube', [10, 10, 10])

  it('a throwing refinement leaves the grid standing', () => {
    const throwing: QuantityChallenger = () => {
      throw new Error('synthetic refinement defect')
    }
    expect(refineWithBarrier(unit, CARTON, NO_CLEARANCE, Infinity, 4, 13, throwing)).toBeNull()
  })

  it('an invalid refinement is discarded, however good its count', () => {
    const overlapping: QuantityChallenger = (): QuantityRefinement => ({
      count: 99,
      placements: Array.from({ length: 2 }, (): Placement => ({
        partName: 'cube',
        rotation: IDENTITY_MAT3,
        translation: [0, 0, 0],
        boxMin: [0, 0, 0],
        boxMax: [10, 10, 10]
      })),
      binding: 'geometry'
    })
    expect(refineWithBarrier(unit, CARTON, NO_CLEARANCE, Infinity, 4, 99, overlapping)).toBeNull()
  })

  it('a valid refinement passes through untouched', () => {
    const valid: QuantityChallenger = (): QuantityRefinement => ({
      count: 2,
      placements: [
        {
          partName: 'cube',
          rotation: IDENTITY_MAT3,
          translation: [0, 0, 0],
          boxMin: [0, 0, 0],
          boxMax: [10, 10, 10]
        },
        {
          partName: 'cube',
          rotation: IDENTITY_MAT3,
          translation: [10, 0, 0],
          boxMin: [10, 0, 0],
          boxMax: [20, 10, 10]
        }
      ],
      binding: 'geometry'
    })
    const out = refineWithBarrier(unit, CARTON, NO_CLEARANCE, Infinity, 1, 99, valid)
    expect(out).not.toBeNull()
    expect(out?.count).toBe(2)
  })

  it('THE ASYMMETRY: a trip does not discard a quantity refinement', () => {
    // §4 makes this same backstop the bound on refinement cost, so tripping is
    // how a large refinement is SUPPOSED to end — the count it reports is a real
    // achieved arrangement. Applying fit check's trip rule here would delete the
    // feature. The 3-cube domino case from phase 4 is the witness: the refined
    // answer must survive, and it must beat the grid.
    const dominoUnit = packBox('domino', [20, 10, 10])
    const carton: Vec3 = [30, 30, 30]
    const request: PackRequest = {
      mode: 'max-quantity',
      tier: 'fast',
      carton,
      clearances: NO_CLEARANCE,
      maxWeightG: Infinity,
      parts: [boxPart('domino', [20, 10, 10])]
    }
    const result = pack(request)
    expect(result.mode).toBe('max-quantity')
    if (result.mode !== 'max-quantity') return
    expect(result.count).toBe(13)

    // And directly: a refinement whose arrangement came out of a TRIPPED EP run
    // is accepted here. The identical situation in racedFit is a discard.
    const fromTrippedEp: QuantityChallenger = (_unit, c, cl, w) => {
      const boxes: PackBox[] = new Array(40).fill(dominoUnit)
      const ep = extremePointFit(boxes, c, cl, w, { maxOps: 60 })
      expect(ep.backstopTripped).toBe(true)
      expect(ep.placements.length).toBeGreaterThan(0)
      return { count: ep.placements.length, placements: ep.placements, binding: ep.binding }
    }
    const out = refineWithBarrier(
      dominoUnit,
      carton,
      NO_CLEARANCE,
      Infinity,
      1,
      13,
      fromTrippedEp
    )
    expect(out?.count).toBeGreaterThan(0)
  })
})

describe('the barrier does not fire on real work', () => {
  it('the golden-shaped assembly load keeps the challenger\'s answer', () => {
    // A standing assertion that the barrier is dormant in production: if a
    // refactor makes it discard healthy EP output, the app silently loses the
    // whole ADR-0022 improvement while every other spec still passes.
    const raced = racedFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    const ep: EpFitPlacement = extremePointFit(LOAD, CARTON, NO_CLEARANCE, Infinity)
    expect(ep.backstopTripped).toBe(false)
    expect(raced.placements).toEqual(ep.placements)
  })
})
