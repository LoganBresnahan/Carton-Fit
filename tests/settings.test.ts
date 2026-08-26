import { describe, expect, it, beforeEach } from 'vitest'
import {
  innerCartonMm,
  resolvedView,
  settingsFromStored,
  useAppStore,
  type PackingSettings
} from '../src/renderer/src/store'
import type { PackRequest, PackResult } from '../src/renderer/src/core/packing/types'

function settings(patch: Partial<PackingSettings> = {}): PackingSettings {
  return { ...useAppStore.getState().settings, ...patch }
}

describe('innerCartonMm', () => {
  it('returns the raw dims when entering inner dimensions', () => {
    expect(innerCartonMm(settings({ enterOuter: false, boxDimsMm: [100, 200, 300] }))).toEqual([
      100, 200, 300
    ])
  })

  it('subtracts 2× wall on each axis when entering outer dimensions', () => {
    expect(
      innerCartonMm(settings({ enterOuter: true, wallMm: 5, boxDimsMm: [100, 200, 300] }))
    ).toEqual([90, 190, 290])
  })
})

describe('settings slice', () => {
  beforeEach(() => {
    useAppStore.getState().updateSettings({ mode: 'fit-check', tier: 'fast' })
  })

  it('defaults to fit-check / fast with the 35 lb weight cap', () => {
    const s = useAppStore.getState().settings
    expect(s.mode).toBe('fit-check')
    expect(s.tier).toBe('fast')
    expect(s.maxWeightG).toBeCloseTo(15875.7, 0) // 35 lb in grams
  })

  it('derives weight units for a pre-ADR-0024 blob from its own toggle', () => {
    // The blob predates per-input weight units, so what it meant by 'metric'
    // was kg — the display must stay exactly where that user left it.
    const metric = settingsFromStored({ unitSystem: 'metric' })
    expect(metric.maxWeightUnit).toBe('kg')
    expect(metric.partWeightUnit).toBe('kg')
    const imperial = settingsFromStored({ unitSystem: 'imperial' })
    expect(imperial.maxWeightUnit).toBe('lb')
    expect(imperial.partWeightUnit).toBe('lb')
  })

  it('keeps explicit weight units over the legacy derivation', () => {
    const s = settingsFromStored({ unitSystem: 'metric', maxWeightUnit: 'g', partWeightUnit: 'lb' })
    expect(s.maxWeightUnit).toBe('g')
    expect(s.partWeightUnit).toBe('lb')
  })

  it('updateSettings merges a patch and swaps the settings object identity', () => {
    const before = useAppStore.getState().settings
    useAppStore.getState().updateSettings({ tier: 'thorough' })
    const after = useAppStore.getState().settings
    expect(after.tier).toBe('thorough')
    expect(after.mode).toBe(before.mode) // untouched field preserved
    expect(after).not.toBe(before) // new identity → persistence subscription fires
  })
})

describe('resolvedView', () => {
  it('follows the estimate in auto mode', () => {
    expect(resolvedView('auto', false)).toBe('model')
    expect(resolvedView('auto', true)).toBe('packed')
  })

  it('pins the model even once an estimate exists', () => {
    // Without pinning, inspecting the model would be undone by the next
    // re-pack — a keystroke away under ADR-0009.
    expect(resolvedView('model', true)).toBe('model')
  })

  it('falls back to the model when packed is pinned but nothing is packed yet', () => {
    expect(resolvedView('packed', false)).toBe('model')
    expect(resolvedView('packed', true)).toBe('packed')
  })
})

describe('pack slice', () => {
  const result: PackResult = {
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    unplaced: [],
    placements: [],
    binding: 'geometry',
    heuristic: true,
    utilization: 0.25
  }

  const request: PackRequest = {
    mode: 'fit-check',
    tier: 'fast',
    carton: [100, 100, 100],
    clearances: { betweenParts: 0, wall: 0 },
    maxWeightG: Infinity,
    parts: []
  }

  beforeEach(() => {
    useAppStore.getState().resetImport()
  })

  it('starts idle with no result', () => {
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('idle')
    expect(s.packResult).toBeNull()
  })

  it('walks begin → succeed, recording the result and elapsed time', () => {
    useAppStore.getState().packBegan()
    expect(useAppStore.getState().packStatus).toBe('packing')

    useAppStore.getState().packSucceeded(result, request, 42)
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('done')
    expect(s.packResult).toBe(result)
    expect(s.packElapsedMs).toBe(42)
    expect(s.packError).toBeNull()
  })

  it('keeps the previous result while a new pack is in flight', () => {
    // The panel shows the prior estimate (dimmed) rather than flashing empty.
    useAppStore.getState().packSucceeded(result, request, 10)
    useAppStore.getState().packBegan()
    expect(useAppStore.getState().packResult).toBe(result)
  })

  it('drops the result on failure', () => {
    useAppStore.getState().packSucceeded(result, request, 10)
    useAppStore.getState().packFailed('worker died')
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('failed')
    expect(s.packError).toBe('worker died')
    expect(s.packResult).toBeNull()
  })

  it('clears the max-quantity unit selection on a new import', () => {
    // Part names belong to the loaded file; carrying one across imports would
    // silently pack the wrong thing (or nothing).
    useAppStore.getState().setUnitPartName('bracket')
    expect(useAppStore.getState().unitPartName).toBe('bracket')
    useAppStore.getState().beginImport({ name: 'other.stp', sizeBytes: 1 })
    expect(useAppStore.getState().unitPartName).toBeNull()
  })

  it('clears a stale estimate when a new import begins', () => {
    useAppStore.getState().packSucceeded(result, request, 10)
    useAppStore.getState().beginImport({ name: 'next.stp', sizeBytes: 1 })
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('idle')
    expect(s.packResult).toBeNull()
    expect(s.packElapsedMs).toBeNull()
  })
})
