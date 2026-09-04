import { describe, expect, it } from 'vitest'
import {
  bindingHeading,
  bindingLabel,
  freeSpaceNote,
  freeSpaceReport,
  openMeshWarning,
  packedWeightG,
  truncatedLayout,
  upperBoundLabel,
  utilizationPercent,
  bindingReport,
  verdictCaption,
  verdictHeadline
} from '../src/renderer/src/packing/verdict'
import { inToMm } from '../src/renderer/src/core/units'
import type {
  FitCheckResult,
  MaxQuantityResult,
  PackRequest
} from '../src/renderer/src/core/packing/types'

// heuristic-verdict-labeling wording (ADR-0003). These assertions pin the CLAIM
// each phrasing makes, not its prose: a positive fit may be stated as certain
// (we hold the arrangement), a non-fit and a count may not.

function fit(patch: Partial<FitCheckResult> = {}): FitCheckResult {
  return {
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    unplaced: [],
    placements: [],
    binding: 'geometry',
    heuristic: true,
    utilization: 0,
    ...patch
  }
}

function qty(patch: Partial<MaxQuantityResult> = {}): MaxQuantityResult {
  const base = {
    mode: 'max-quantity' as const,
    tier: 'fast' as const,
    count: 0,
    placements: [],
    binding: 'geometry' as const,
    heuristic: true,
    utilization: 0,
    ...patch
  }
  // Defaulted from the patched count, never from the base one: the engine's
  // invariant is `spaceOnlyCount >= count`, so a fixture defaulting to 0 would
  // hand the wording layer a state the engine cannot produce.
  return { ...base, spaceOnlyCount: patch.spaceOnlyCount ?? base.count }
}

/** A placement stub — only its presence/count matters to the wording. */
const placement = {
  partName: 'p',
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
  boxMin: [0, 0, 0],
  boxMax: [1, 1, 1]
} as FitCheckResult['placements'][number]

describe('verdictCaption', () => {
  it('states a positive fit as a found arrangement, without hedging', () => {
    const caption = verdictCaption(fit({ fits: true, placements: [placement] }))
    expect(caption).toMatch(/All 1 part fit/)
    expect(caption).not.toMatch(/[Hh]euristic/) // a constructive proof needs no hedge
  })

  it('refuses to present a non-fit as proof', () => {
    const caption = verdictCaption(
      fit({ fits: false, placements: [placement], unplaced: ['b', 'c'] })
    )
    expect(caption).toMatch(/1 of 3 parts placed/)
    expect(caption).toMatch(/not a proof the rest cannot fit/)
  })

  it('states a count as a lower bound with the binding reason', () => {
    expect(verdictCaption(qty({ count: 5, binding: 'weight' }))).toMatch(
      /At least 5 fit \(weight-limited\)\. Heuristic — a mixed arrangement may fit more\./
    )
    expect(verdictCaption(qty({ count: 12, binding: 'geometry' }))).toMatch(/space-limited/)
    // Grouped like the headline — the two must not disagree on the same number.
    expect(verdictCaption(qty({ count: 27000 }))).toMatch(/At least 27,000 fit/)
  })

  it('drops the hedge when the bound says nothing more can fit', () => {
    // THE 2026-09-03 DOGFOOD FINDING. A reply carrying `count: 3` and
    // `upperBound: 3` also carried "a mixed arrangement may fit more" — one
    // payload arguing with itself, sending the reader after a fourth unit it
    // had already ruled out. The hedge is a claim like any other, and the bound
    // is what settles it.
    const caption = verdictCaption(qty({ count: 3, binding: 'weight', upperBound: 3 }))
    expect(caption).toMatch(/^3 fit \(weight-limited\)/)
    expect(caption).toMatch(/no arrangement beats this under these limits/)
    expect(caption).not.toMatch(/may fit more/)
    // "At least" invites the same search the bound forecloses.
    expect(caption).not.toMatch(/At least/)
  })

  it('keeps the hedge whenever the bound leaves room, or does not exist', () => {
    // The hedge is the DEFAULT and must survive: a bound above the count is the
    // ordinary case, and a bound that does not exist establishes nothing.
    expect(verdictCaption(qty({ count: 3, upperBound: 5 }))).toMatch(/may fit more/)
    expect(verdictCaption(qty({ count: 3 }))).toMatch(/may fit more/)
  })

  it('handles the empty and none cases', () => {
    expect(verdictCaption(fit({ fits: true }))).toBe('Nothing to pack.')
    expect(verdictCaption(qty({ count: 0 }))).toBe('None fit in this carton.')
  })

  it('a zero names its limit unless the carton is what stopped it', () => {
    // 6th dogfood run: cap 35 lb against a hand-typed 40 lb plate counts 0
    // while `geometryBound: 3` says the carton takes three. "in this carton"
    // is a claim about SPACE, and the zero branch was making it without ever
    // consulting the space bound — two lines above a correct binding note in
    // the same exported quote block.
    expect(verdictCaption(qty({ count: 0, binding: 'weight', geometryBound: 3 }))).toBe(
      'None fit (weight-limited).'
    )
    // ...and it survives untouched where the bound licenses it: a part the
    // carton genuinely cannot take, which is the case the sentence was written
    // for. Both arms matter — a fix that only ever says "weight-limited" would
    // trade one unbacked claim for another.
    expect(verdictCaption(qty({ count: 0, binding: 'weight', geometryBound: 0 }))).toBe(
      'None fit in this carton.'
    )
    // No bound at all establishes nothing, so the wording may not get sharper.
    expect(verdictCaption(qty({ count: 0, binding: 'weight' }))).toBe('None fit in this carton.')
  })
})

describe('bindingReport', () => {
  // The prose layer moved here from the MCP module on 2026-09-03 so the panel,
  // both exports and the wire read one sentence. Every branch below is a claim
  // the phase-2 amendments once found wrong on a real part, pinned by the
  // FIELD that now backs it — the evidence kind is the point of each case.
  const request = (maxWeightG: number, weightG = 1): PackRequest => ({
    mode: 'max-quantity',
    tier: 'fast',
    carton: [100, 100, 100],
    clearances: { betweenParts: 0, wall: 0 },
    maxWeightG,
    parts: [{ name: 'p', positions: new Float32Array(0), weightG }]
  })

  it('proves the carton full only from the bound', () => {
    const r = bindingReport(qty({ count: 8, binding: 'weight', geometryBound: 8 }), request(8))
    expect(r.otherConstraint).toEqual({ known: true, atLimit: true, evidence: 'bound' })
    expect(r.note).toMatch(/Both limits land on 8/)
  })

  it('proves the carton has room only from an arrangement', () => {
    const r = bindingReport(
      qty({ count: 3, binding: 'weight', geometryBound: 5, spaceOnlyCount: 6 }),
      request(30)
    )
    expect(r.otherConstraint).toEqual({ known: true, atLimit: false, evidence: 'arrangement' })
    expect(r.note).toMatch(/carton itself would take 6/)
  })

  it('reports the lifted-cap search as evidence, in different words from the proof', () => {
    const r = bindingReport(
      qty({ count: 3, binding: 'weight', geometryBound: 5, spaceOnlyCount: 3 }),
      request(30)
    )
    expect(r.otherConstraint).toEqual({ known: true, atLimit: true, evidence: 'search' })
    expect(r.note).toMatch(/as far as this search can tell/)
    expect(r.note).not.toMatch(/Both limits land/)
  })

  it('answers a loose bound from the arrangement, never from the ceiling', () => {
    // WAS "stays silent … and calls the bound a ceiling" until 2026-09-04. That
    // silence described a state the ENGINE COULD NOT PRODUCE: a weight-bound
    // count with a loose bound is exactly when the cap-lifted rerun runs, so
    // `spaceOnlyCount` was always there to answer with. The old expectation
    // held only because the fixture omitted a field the engine always set —
    // which is why the branch is gone rather than re-pinned.
    //
    // The claim it was protecting survives intact and is asserted here: a bound
    // of 5 above a count of 3 must never be read as room. Room is reported only
    // when something was PLACED (evidence 'arrangement'), and a rerun that
    // matched the count reports 'search' — never "might hold as many as 5".
    const roomy = bindingReport(
      qty({ count: 3, binding: 'weight', geometryBound: 5, spaceOnlyCount: 4 }),
      request(30)
    )
    expect(roomy.otherConstraint).toEqual({ known: true, atLimit: false, evidence: 'arrangement' })
    expect(roomy.note).toMatch(/the carton itself would take 4/)
    expect(roomy.note).not.toMatch(/5/)

    const full = bindingReport(
      qty({ count: 3, binding: 'weight', geometryBound: 5, spaceOnlyCount: 3 }),
      request(30)
    )
    expect(full.otherConstraint).toEqual({ known: true, atLimit: true, evidence: 'search' })
    expect(full.note).toMatch(/as far as this search can tell/)
    expect(full.note).not.toMatch(/might hold/)
  })

  it('names the side its evidence is about on a comfortable fit', () => {
    // Weight closest → the OTHER is space, settled by the arrangement we hold.
    // Space closest → the other is weight, settled by packed weight vs cap.
    // A reader filtering on evidence found a weight fact labelled 'arrangement'.
    const weightClosest = bindingReport(fit({ fits: true, binding: 'weight', placements: [placement] }), request(1000, 1))
    expect(weightClosest.otherConstraint).toEqual({ known: true, atLimit: false, evidence: 'arrangement' })
    const spaceClosest = bindingReport(fit({ fits: true, binding: 'geometry', placements: [placement] }), request(1000, 1))
    expect(spaceClosest.otherConstraint).toEqual({ known: true, atLimit: false, evidence: 'arithmetic' })
  })

  it('refuses to guess about space on a weight-bound MIXED SET', () => {
    // A fit-check packs whatever parts the file has, and no rigorous bound
    // exists for how tightly THAT set could be made to sit — so a
    // weight-stopped fit-check cannot say whether the carton also ran out.
    // The branch is the one place `known: false` is the right answer rather
    // than a gap, which is exactly why it went untested until the 2026-09-03
    // /shipshape counted the branches.
    const r = bindingReport(
      fit({ fits: false, binding: 'weight', placements: [placement], unplaced: ['b'] }),
      request(10, 100)
    )
    expect(r.bound).toBe(true)
    expect(r.otherConstraint.known).toBe(false)
    if (r.otherConstraint.known) throw new Error('unreachable')
    expect(r.otherConstraint.reason).toMatch(/mixed set/)
    expect(r.otherConstraint.reason).toMatch(/no rigorous bound/)
    // And the note claims exactly that much — no more.
    expect(r.note).toMatch(/not established/)
  })

  it('says a cap that was never supplied cannot be reasoned about', () => {
    // maxWeightG 0 is "no cap", not "a cap of nothing" — the second reading
    // would make every answer weight-bound at zero. With no cap there is no
    // arithmetic to do, so the field says so instead of inventing headroom.
    const r = bindingReport(qty({ count: 4, binding: 'geometry' }), request(0, 5))
    expect(r.otherConstraint.known).toBe(false)
    if (r.otherConstraint.known) throw new Error('unreachable')
    expect(r.otherConstraint.reason).toBe('no weight cap was supplied')
    expect(r.note).toMatch(/no weight cap applied/)
    // The same holds for an infinite cap, which is how the engine spells
    // "lifted" internally (ADR-0033's rerun) and what a caller omitting the
    // field gets.
    const lifted = bindingReport(qty({ count: 4, binding: 'geometry' }), request(Infinity, 5))
    expect(lifted.otherConstraint).toEqual(r.otherConstraint)
  })

  it('drops the closer-limit ranking when every part is weightless', () => {
    const r = bindingReport(fit({ fits: true, placements: [placement] }), request(1000, 0))
    expect(r.bound).toBe(false)
    expect(r.otherConstraint).toEqual({ known: true, atLimit: false, evidence: 'arithmetic' })
    expect(r.note).toMatch(/No part weight was given/)
    expect(r.note).not.toMatch(/closer limit/)
  })
})

describe('verdictHeadline', () => {
  it('answers the question asked by the mode', () => {
    expect(verdictHeadline(fit({ fits: true }))).toBe('Fits')
    expect(verdictHeadline(fit({ fits: false }))).toBe("Doesn't fit")
    expect(verdictHeadline(qty({ count: 1234 }))).toBe('1,234')
  })
})

describe('bindingHeading', () => {
  it('says "Closest limit" on a fit, because nothing bound', () => {
    expect(bindingHeading(fit({ fits: true, binding: 'weight' }))).toBe('Closest limit')
  })
  it('says "Limited by" wherever a constraint actually stopped something', () => {
    expect(bindingHeading(fit({ fits: false, unplaced: ['plate'] }))).toBe('Limited by')
    expect(bindingHeading(qty({ count: 3, binding: 'weight' }))).toBe('Limited by')
  })
})

describe('bindingLabel', () => {
  it('names the constraint in user words', () => {
    expect(bindingLabel('weight')).toBe('weight')
    expect(bindingLabel('geometry')).toBe('space')
  })
})

describe('utilizationPercent', () => {
  it('rounds, and never rounds a non-empty carton down to 0%', () => {
    expect(utilizationPercent(0)).toBe('0%')
    expect(utilizationPercent(0.6423)).toBe('64%')
    expect(utilizationPercent(1)).toBe('100%')
    expect(utilizationPercent(0.0001)).toBe('<1%')
  })
})

describe('packedWeightG', () => {
  const request = (weights: number[]): PackRequest => ({
    mode: 'fit-check',
    tier: 'fast',
    carton: [100, 100, 100],
    clearances: { betweenParts: 0, wall: 0 },
    maxWeightG: 10_000,
    parts: weights.map((weightG, i) => ({
      name: `p${i}`,
      positions: new Float32Array([0, 0, 0]),
      weightG
    }))
  })

  it('sums the weights of the parts actually placed (fit-check)', () => {
    const placed = (name: string): FitCheckResult['placements'][number] => ({
      ...placement,
      partName: name
    })
    const result = fit({ placements: [placed('p0'), placed('p2')], unplaced: ['p1'] })
    expect(packedWeightG(result, request([100, 500, 250]))).toBe(350) // p1 excluded
  })

  it('multiplies count by unit weight (max-quantity), not placements', () => {
    // The count can exceed the materialized placements, so summing placements
    // would under-report the very number the weight cap is judged against.
    const result = qty({ count: 1000, placements: [placement] })
    expect(packedWeightG(result, request([12]))).toBe(12_000)
  })

  it('sums a composed multi-part unit', () => {
    const result = qty({ count: 5, placements: [placement] })
    expect(packedWeightG(result, request([10, 20, 30]))).toBe(300) // 5 × 60
  })
})

describe('openMeshWarning', () => {
  it('says nothing when every packed part is closed', () => {
    expect(openMeshWarning([])).toBeNull()
  })

  it('names the part and tells the user how to get a trustworthy number', () => {
    const message = openMeshWarning(['bracket'])
    expect(message).toContain('bracket')
    expect(message).toMatch(/is not a closed mesh/)
    // The actionable half matters as much as the diagnosis: "not watertight"
    // alone reads as a modelling nitpick, not "the count above is wrong".
    expect(message).toMatch(/weight directly/i)
  })

  it('agrees in number for several parts', () => {
    expect(openMeshWarning(['a', 'b'])).toMatch(/are not closed meshes/)
  })

  it('caps the list rather than printing a whole assembly', () => {
    const message = openMeshWarning(['a', 'b', 'c', 'd', 'e'])
    expect(message).toContain('and 2 more')
    expect(message).not.toContain('“d”')
  })
})

describe('truncatedLayout', () => {
  it('flags a layout whose placements were capped below the true count', () => {
    expect(truncatedLayout(qty({ count: 200_000, placements: [placement] }))).toBe(true)
    expect(truncatedLayout(qty({ count: 1, placements: [placement] }))).toBe(false)
    expect(truncatedLayout(fit({ placements: [placement] }))).toBe(false)
  })
})

// ADR-0022 §7 wording. These pin the CLAIM again, not the prose: the bound may be
// stated flatly because it is rigorous, and the free-space line may only put two
// numbers side by side — never draw the conclusion.

describe('upperBoundLabel', () => {
  it('states the bound flatly, grouped like the count beside it', () => {
    expect(upperBoundLabel(qty({ count: 47, upperBound: 54 }))).toBe('upper bound 54')
    expect(upperBoundLabel(qty({ count: 27_000, upperBound: 31_500 }))).toBe('upper bound 31,500')
    // No hedge: unlike the count, this one is not a heuristic.
    expect(upperBoundLabel(qty({ count: 47, upperBound: 54 }))).not.toMatch(/about|roughly|may/)
  })

  it('says nothing when there is no bound, and nothing in fit check', () => {
    expect(upperBoundLabel(qty({ count: 5 }))).toBeNull()
    expect(upperBoundLabel(fit({ fits: false, unplaced: ['a'] }))).toBeNull()
  })

  it('shows the bound even when the count has met it — that is optimality', () => {
    expect(upperBoundLabel(qty({ count: 12, upperBound: 12 }))).toBe('upper bound 12')
  })
})

describe('freeSpaceNote', () => {
  const nonFit = (patch: Partial<FitCheckResult> = {}): FitCheckResult =>
    fit({ fits: false, placements: [placement], unplaced: ['bracket'], ...patch })

  it('puts the two triples side by side, both descending, in on-screen units', () => {
    const note = freeSpaceNote(
      nonFit({
        largestFreeSpace: [80, 40, 120],
        smallestUnplaced: { name: 'bracket', extentMm: [60, 150, 30] }
      }),
      'metric'
    )
    // Descending on both sides so they compare down the line — the engine's axis
    // order is its own placement choice, not a property of the part.
    expect(note).toBe(
      'Largest free space: 120 × 80 × 40 mm — smallest orientation of “bracket” needs 150 × 60 × 30 mm.'
    )
  })

  it('converts to inches at the UI boundary like every other figure', () => {
    const note = freeSpaceNote(
      nonFit({
        largestFreeSpace: [inToMm(4), inToMm(2), inToMm(6)],
        smallestUnplaced: { name: 'bracket', extentMm: [inToMm(3), inToMm(8), inToMm(1)] }
      }),
      'imperial'
    )
    expect(note).toBe(
      'Largest free space: 6 × 4 × 2 in — smallest orientation of “bracket” needs 8 × 3 × 1 in.'
    )
  })

  it('never concludes anything — placement is still heuristic', () => {
    const note = freeSpaceNote(
      nonFit({
        largestFreeSpace: [10, 10, 10],
        smallestUnplaced: { name: 'bracket', extentMm: [50, 50, 50] }
      }),
      'metric'
    )
    expect(note).not.toMatch(/too small|cannot|won't|will not|impossible/i)
  })

  it('THE GATE: drops the comparison when the leftover would have fit the space', () => {
    // A weight-bound non-fit leaves parts that fit the space perfectly well. Two
    // triples that plainly do fit, printed side by side under "did not fit", read
    // as an app that cannot do arithmetic.
    const result = nonFit({
      binding: 'weight',
      largestFreeSpace: [250, 180, 100],
      smallestUnplaced: { name: 'bolt', extentMm: [8, 8, 5] }
    })
    expect(freeSpaceReport(result)?.need).toBeUndefined()
    expect(freeSpaceNote(result, 'metric')).toBe('Largest free space: 250 × 180 × 100 mm.')
  })

  it('gates on the sorted comparison, not on axis order', () => {
    // 40×10×10 does not fit 20×20×20 axis-for-axis, and does not fit it in any
    // rotation either — the sorted compare is what says so.
    const blocked = nonFit({
      largestFreeSpace: [20, 20, 20],
      smallestUnplaced: { name: 'rod', extentMm: [10, 40, 10] }
    })
    expect(freeSpaceReport(blocked)?.need?.extentMm).toEqual([40, 10, 10])
    // ...while a part that only needs turning DOES fit, so the comparison drops.
    const turnable = nonFit({
      largestFreeSpace: [30, 10, 20],
      smallestUnplaced: { name: 'rod', extentMm: [10, 25, 15] }
    })
    expect(freeSpaceReport(turnable)?.need).toBeUndefined()
  })

  it('says nothing without EMS data, on a fit, or in quantity mode', () => {
    expect(freeSpaceNote(nonFit(), 'metric')).toBeNull() // no largestFreeSpace
    expect(freeSpaceNote(fit({ fits: true, largestFreeSpace: [10, 10, 10] }), 'metric')).toBeNull()
    expect(freeSpaceNote(qty({ count: 3 }), 'metric')).toBeNull()
  })
})
