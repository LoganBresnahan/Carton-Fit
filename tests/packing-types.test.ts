import { describe, expect, it } from 'vitest'
import {
  boxVolume,
  IDENTITY_MAT3,
  MODES,
  TIERS,
  type PackResult
} from '../src/renderer/src/core/packing/types'

describe('packing contract', () => {
  it('offers fit-check first (the default mode) and max-quantity', () => {
    expect(MODES.map((m) => m.mode)).toEqual(['fit-check', 'max-quantity'])
  })

  it('presents all three tiers with nesting visible but disabled (ADR-0003)', () => {
    expect(TIERS.map((t) => t.tier)).toEqual(['fast', 'thorough', 'nesting'])
    const nesting = TIERS.find((t) => t.tier === 'nesting')!
    expect(nesting.enabled).toBe(false)
    expect(nesting.note).toBeTruthy()
    expect(TIERS.filter((t) => t.enabled).map((t) => t.tier)).toEqual(['fast', 'thorough'])
  })

  it('boxVolume multiplies the extent', () => {
    expect(boxVolume([2, 3, 4])).toBe(24)
  })

  it('IDENTITY_MAT3 is the row-major identity', () => {
    expect(IDENTITY_MAT3).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('every result carries a binding constraint (type-level, checked here by shape)', () => {
    const fit: PackResult = {
      mode: 'fit-check',
      tier: 'fast',
      fits: true,
      binding: 'geometry',
      heuristic: true,
      placements: [],
      utilization: 0,
      unplaced: []
    }
    const qty: PackResult = {
      mode: 'max-quantity',
      tier: 'thorough',
      count: 12,
      binding: 'weight',
      heuristic: false,
      placements: [],
      utilization: 0.5
    }
    expect(fit.binding).toBe('geometry')
    expect(qty.binding).toBe('weight')
  })
})
