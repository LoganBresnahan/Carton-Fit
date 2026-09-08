import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, changedGroups } from '../src/renderer/src/packing/settings'
import { buildAppState } from '../src/main/mcp/appState'

// Provenance (ADR-0034 amendment 1): "which of these did I set?" answered by a
// diff against the settings the app launched with.

describe('changedGroups', () => {
  it('is empty when nothing moved', () => {
    expect(changedGroups(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toEqual([])
  })

  it('names the group of every changed field, once, in reply order', () => {
    const changed = {
      ...DEFAULT_SETTINGS,
      densityGPerCm3: 7.85,
      weightMode: 'density' as const,
      maxWeightG: 45359,
      boxDimsMm: [279.4, 152.4, 254] as const,
      wallMm: 25.4
    }
    expect(changedGroups(DEFAULT_SETTINGS, changed)).toEqual(['carton', 'maxWeight', 'weight'])
  })

  it('compares dimensions by value, not identity', () => {
    const same = { ...DEFAULT_SETTINGS, boxDimsMm: [...DEFAULT_SETTINGS.boxDimsMm] as const }
    expect(changedGroups(DEFAULT_SETTINGS, same)).toEqual([])
  })

  it('units are their own group', () => {
    expect(changedGroups(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, unitSystem: 'metric' })).toEqual([
      'displayUnits'
    ])
  })
})

describe('the state reply', () => {
  const source = (settings = DEFAULT_SETTINGS, launchSource: 'defaults' | 'earlier-session' = 'defaults') => ({
    customer: null,
    settingsAtLaunch: DEFAULT_SETTINGS,
    launchSource,
    fileName: null,
    parts: [],
    settings,
    unitPartName: null,
    overrides: {},
    packStatus: 'idle' as const,
    view: 'model' as const
  })

  it('says what this session changed and what the rest is', () => {
    const untouched = buildAppState(source())
    expect(untouched.inputs.provenance).toEqual({ changedThisSession: [], unchangedAre: 'defaults' })
    const capped = buildAppState(source({ ...DEFAULT_SETTINGS, maxWeightG: 15876 }, 'earlier-session'))
    expect(capped.inputs.provenance).toEqual({
      changedThisSession: ['maxWeight'],
      unchangedAre: 'earlier-session'
    })
  })
})
