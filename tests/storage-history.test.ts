import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../src/renderer/src/store'
import { startEstimateRecording } from '../src/renderer/src/storage/history'
import type { StorageApi, EstimateInput } from '../src/shared/storage'
import type { PackResult, PackRequest } from '../src/renderer/src/core/packing/types'

// Exactly-once estimate recording (ADR-0007 / plan phase 6). The failure this
// guards is a duplicate history row per estimate — cheap to create by accident
// (a subscriber fires on every state write) and invisible until history is read.

function fakeApi(): StorageApi & { recorded: EstimateInput[] } {
  const recorded: EstimateInput[] = []
  return {
    recorded,
    recordEstimate: async (entry) => {
      recorded.push(entry)
      return recorded.length
    },
    health: async () => ({ available: true, schemaVersion: 1, quarantined: null, error: null }),
    listConfigurations: async () => [],
    getConfiguration: async () => null,
    saveConfiguration: async () => {},
    removeConfiguration: async () => false,
    recentEstimates: async () => [],
    estimatesForContent: async () => []
  }
}

const RESULT = { verdict: 'fits', quantity: 4 } as unknown as PackResult
const REQUEST = {} as PackRequest

beforeEach(() => {
  useAppStore.getState().resetImport()
})

describe('startEstimateRecording', () => {
  it('records one row per completed estimate', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      await Promise.resolve()
      expect(api.recorded).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('does not re-record when unrelated state changes', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      await Promise.resolve()

      // Every one of these writes fires the subscriber. None is a new estimate.
      useAppStore.getState().setViewMode('model')
      useAppStore.getState().setUnitPartName('bracket')
      useAppStore.getState().updateSettings({ maxWeightG: 999 })
      await Promise.resolve()

      expect(api.recorded).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('records a re-pack that yields an equal-looking result', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      // A DIFFERENT object with identical contents: a genuine second estimate,
      // e.g. the user changed a setting that did not alter the outcome. Keying
      // on value rather than identity would silently drop this.
      useAppStore.getState().packSucceeded({ ...RESULT } as PackResult, REQUEST, 12)
      await Promise.resolve()
      expect(api.recorded).toHaveLength(2)
    } finally {
      stop()
    }
  })

  it('captures the file name, content hash and settings with the result', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().beginImport({ name: 'bracket.stp', sizeBytes: 10 })
      useAppStore
        .getState()
        .importSucceeded([], { elapsedMs: 1, partCount: 1, triangleCount: 2 }, 'deadbeef')
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      await Promise.resolve()

      expect(api.recorded[0].fileName).toBe('bracket.stp')
      expect(api.recorded[0].contentHash).toBe('deadbeef')
      expect(api.recorded[0].result).toBe(RESULT)
      expect(api.recorded[0].settings).toEqual(useAppStore.getState().settings)
    } finally {
      stop()
    }
  })

  it('does not record a failed pack', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().packBegan()
      useAppStore.getState().packFailed('worker died')
      await Promise.resolve()
      expect(api.recorded).toHaveLength(0)
    } finally {
      stop()
    }
  })

  it('survives a rejecting storage layer without breaking the estimate', async () => {
    const api = fakeApi()
    api.recordEstimate = async () => {
      throw new Error('storage is unavailable')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = startEstimateRecording(api)
    try {
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      await Promise.resolve()
      await Promise.resolve()

      // The estimate itself is untouched — storage is optional (ADR-0007).
      expect(useAppStore.getState().packResult).toBe(RESULT)
      expect(useAppStore.getState().packStatus).toBe('done')
    } finally {
      stop()
      warn.mockRestore()
    }
  })

  it('is idempotent, because StrictMode double-invokes effects', async () => {
    const api = fakeApi()
    const stop = startEstimateRecording(api)
    const stopAgain = startEstimateRecording(api)
    try {
      useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
      await Promise.resolve()
      expect(api.recorded).toHaveLength(1)
    } finally {
      stopAgain()
      stop()
    }
  })
})
