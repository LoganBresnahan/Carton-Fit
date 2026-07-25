import { describe, expect, it, beforeEach } from 'vitest'
import { innerCartonMm, useAppStore, type PackingSettings } from '../src/renderer/src/store'
import type { PackResult } from '../src/renderer/src/core/packing/types'

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

  it('updateSettings merges a patch and swaps the settings object identity', () => {
    const before = useAppStore.getState().settings
    useAppStore.getState().updateSettings({ tier: 'thorough' })
    const after = useAppStore.getState().settings
    expect(after.tier).toBe('thorough')
    expect(after.mode).toBe(before.mode) // untouched field preserved
    expect(after).not.toBe(before) // new identity → persistence subscription fires
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

    useAppStore.getState().packSucceeded(result, 42)
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('done')
    expect(s.packResult).toBe(result)
    expect(s.packElapsedMs).toBe(42)
    expect(s.packError).toBeNull()
  })

  it('keeps the previous result while a new pack is in flight', () => {
    // The panel shows the prior estimate (dimmed) rather than flashing empty.
    useAppStore.getState().packSucceeded(result, 10)
    useAppStore.getState().packBegan()
    expect(useAppStore.getState().packResult).toBe(result)
  })

  it('drops the result on failure', () => {
    useAppStore.getState().packSucceeded(result, 10)
    useAppStore.getState().packFailed('worker died')
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('failed')
    expect(s.packError).toBe('worker died')
    expect(s.packResult).toBeNull()
  })

  it('clears a stale estimate when a new import begins', () => {
    useAppStore.getState().packSucceeded(result, 10)
    useAppStore.getState().beginImport({ name: 'next.stp', sizeBytes: 1 })
    const s = useAppStore.getState()
    expect(s.packStatus).toBe('idle')
    expect(s.packResult).toBeNull()
    expect(s.packElapsedMs).toBeNull()
  })
})
