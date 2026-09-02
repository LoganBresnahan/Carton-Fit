import { describe, expect, it } from 'vitest'
import { settingsPatchFrom } from '../src/main/mcp/inputs'
import { EstimateInputError } from '../src/main/mcp/estimate'

// `set_inputs` → PackingSettings patch (ADR-0029 v2). The properties under
// test are the contract's: absent fields produce NO patch key (partial update
// over live state), every conversion goes through wire.ts's unit math, and
// the calls the engine must never see are refused with a worded message.

describe('settingsPatchFrom', () => {
  it('an empty call patches nothing', () => {
    expect(settingsPatchFrom({})).toEqual({})
  })

  it('converts carton dimensions with their unit, and only what was named', () => {
    const patch = settingsPatchFrom({
      carton: { dimensions: { x: 12, y: 12, z: 12, unit: 'in' } }
    })
    expect(Object.keys(patch)).toEqual(['boxDimsMm'])
    for (const value of patch.boxDimsMm ?? []) expect(value).toBeCloseTo(304.8, 9)
    // measured and wallThickness were not mentioned: enterOuter/wallMm absent,
    // so the app keeps what it has — the panel-edit semantics.
    expect('enterOuter' in patch).toBe(false)
    expect('wallMm' in patch).toBe(false)
  })

  it('maps measured/wall/clearances/cap through the same wire units', () => {
    expect(
      settingsPatchFrom({
        carton: { measured: 'outer', wallThickness: { value: 0.25, unit: 'in' } },
        clearances: { betweenParts: { value: 5, unit: 'mm' } },
        maxWeight: { value: 1, unit: 'lb' }
      })
    ).toEqual({
      enterOuter: true,
      wallMm: 6.35,
      clearancePartMm: 5,
      maxWeightG: 453.59237
    })
  })

  it('a part weight switches to direct mode; a density to density mode', () => {
    expect(settingsPatchFrom({ weight: { partWeight: { value: 2, unit: 'kg' } } })).toEqual({
      weightMode: 'direct',
      partWeightG: 2000
    })
    expect(settingsPatchFrom({ weight: { densityGPerCm3: 2.7 } })).toEqual({
      weightMode: 'density',
      densityGPerCm3: 2.7
    })
  })

  it('both weight sources at once is refused, worded for the client', () => {
    expect(() =>
      settingsPatchFrom({
        weight: { partWeight: { value: 1, unit: 'g' }, densityGPerCm3: 1 }
      })
    ).toThrow(EstimateInputError)
  })

  it('the nesting tier is refused the same way the stateless call refuses it', () => {
    expect(() => settingsPatchFrom({ tier: 'nesting' as never })).toThrow(EstimateInputError)
  })

  it('display units move the three selectors independently (ADR-0024)', () => {
    expect(
      settingsPatchFrom({ displayUnits: { length: 'in', partWeight: 'g' } })
    ).toEqual({ unitSystem: 'imperial', partWeightUnit: 'g' })
  })
})
