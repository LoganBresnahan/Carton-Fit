import { describe, expect, it, beforeEach } from 'vitest'
import { innerCartonMm, useAppStore, type PackingSettings } from '../src/renderer/src/store'

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
