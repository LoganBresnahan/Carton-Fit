import { describe, expect, it } from 'vitest'
import {
  bindingLabel,
  packedWeightG,
  truncatedLayout,
  utilizationPercent,
  verdictCaption,
  verdictHeadline
} from '../src/renderer/src/packing/verdict'
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
  return {
    mode: 'max-quantity',
    tier: 'fast',
    count: 0,
    placements: [],
    binding: 'geometry',
    heuristic: true,
    utilization: 0,
    ...patch
  }
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

  it('handles the empty and none cases', () => {
    expect(verdictCaption(fit({ fits: true }))).toBe('Nothing to pack.')
    expect(verdictCaption(qty({ count: 0 }))).toBe('None fit in this carton.')
  })
})

describe('verdictHeadline', () => {
  it('answers the question asked by the mode', () => {
    expect(verdictHeadline(fit({ fits: true }))).toBe('Fits')
    expect(verdictHeadline(fit({ fits: false }))).toBe("Doesn't fit")
    expect(verdictHeadline(qty({ count: 1234 }))).toBe('1,234')
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

describe('truncatedLayout', () => {
  it('flags a layout whose placements were capped below the true count', () => {
    expect(truncatedLayout(qty({ count: 200_000, placements: [placement] }))).toBe(true)
    expect(truncatedLayout(qty({ count: 1, placements: [placement] }))).toBe(false)
    expect(truncatedLayout(fit({ placements: [placement] }))).toBe(false)
  })
})
