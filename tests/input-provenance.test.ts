import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, changedGroups, writtenGroups } from '../src/renderer/src/packing/settings'
import { buildAppState } from '../src/main/mcp/appState'
import { useAppStore } from '../src/renderer/src/store'
import { redo, resetUndoHistory, startUndoHistory, undo } from '../src/renderer/src/history/undo'

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

// The other half (ADR-0034 amendment 2, twelfth dogfood): a reader set every
// group to the value it had inherited, got [], and could not show it had done
// the defensive move the brief prescribes. Written is a different question
// from changed, and it gets its own list.
describe('writtenGroups', () => {
  it('names the group of every key in the patch, value or no value', () => {
    expect(writtenGroups([], { wallMm: 0, clearanceWallMm: 0 })).toEqual(['carton', 'clearances'])
  })

  it('accumulates in reply order and never repeats', () => {
    const first = writtenGroups([], { maxWeightG: 1 })
    expect(writtenGroups(first, { mode: 'fit-check', maxWeightG: 2 })).toEqual(['mode', 'maxWeight'])
  })

  it('ignores keys that are not inputs', () => {
    expect(writtenGroups([], { stray: 1 } as never)).toEqual([])
  })
})

describe('the store’s written set', () => {
  beforeEach(() => {
    resetUndoHistory()
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, settingsWritten: [] })
    startUndoHistory(() => 0)
  })
  afterEach(() => resetUndoHistory())

  it('records a write to the value the input already had', () => {
    useAppStore.getState().updateSettings({ clearanceWallMm: DEFAULT_SETTINGS.clearanceWallMm })
    const state = useAppStore.getState()
    expect(state.settingsWritten).toEqual(['clearances'])
    expect(changedGroups(DEFAULT_SETTINGS, state.settings)).toEqual([])
  })

  it('keeps a group once its value has gone back to where it started', () => {
    useAppStore.getState().updateSettings({ clearanceWallMm: 6.35 })
    useAppStore.getState().updateSettings({ clearanceWallMm: DEFAULT_SETTINGS.clearanceWallMm })
    expect(useAppStore.getState().settingsWritten).toEqual(['clearances'])
  })

  it('counts a restore, but not the undo or redo of one', () => {
    useAppStore.getState().restoreInputs({ maxWeightG: 500 }, {})
    expect(useAppStore.getState().settingsWritten).toEqual(['maxWeight'])
    expect(undo()).toBe(true)
    expect(useAppStore.getState().settings.maxWeightG).toBe(DEFAULT_SETTINGS.maxWeightG)
    expect(useAppStore.getState().settingsWritten).toEqual(['maxWeight'])
    expect(redo()).toBe(true)
    expect(useAppStore.getState().settingsWritten).toEqual(['maxWeight'])
  })
})

describe('the state reply', () => {
  const source = (settings = DEFAULT_SETTINGS, launchSource: 'defaults' | 'earlier-session' = 'defaults') => ({
    customer: null,
    settingsAtLaunch: DEFAULT_SETTINGS,
    settingsWritten: [],
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
    expect(untouched.inputs.provenance).toEqual({
      changedThisSession: [],
      setThisSession: [],
      unchangedAre: 'defaults'
    })
    const capped = buildAppState(source({ ...DEFAULT_SETTINGS, maxWeightG: 15876 }, 'earlier-session'))
    expect(capped.inputs.provenance).toEqual({
      changedThisSession: ['maxWeight'],
      setThisSession: [],
      unchangedAre: 'earlier-session'
    })
  })

  it('lists a group written to its inherited value as set, not changed', () => {
    const confirmed = buildAppState({ ...source(DEFAULT_SETTINGS, 'earlier-session'), settingsWritten: ['clearances'] })
    expect(confirmed.inputs.provenance).toEqual({
      changedThisSession: [],
      setThisSession: ['clearances'],
      unchangedAre: 'earlier-session'
    })
  })
})
