import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'
import { useAppStore } from '../src/renderer/src/store'
import {
  refreshSavedEstimates,
  restoreEstimateSettings,
  saveEstimate
} from '../src/renderer/src/storage/estimates'
import type { EstimateInput, EstimateRow, StorageApi } from '../src/shared/storage'
import type { PackResult, PackRequest } from '../src/renderer/src/core/packing/types'

// Saved estimates (ADR-0016). This file replaces the exactly-once
// auto-recording suite: the failure it guarded — a duplicate row per estimate,
// created by a subscriber firing on every state write — cannot happen once a
// row is written only when the user asks for one.
//
// What matters now is that saving captures WHAT IS ON SCREEN, that a stale or
// absent estimate cannot be filed as a receipt, and that restoring a row brings
// back settings and never a result.

function fakeApi(rows: EstimateRow[] = []): StorageApi & { recorded: EstimateInput[] } {
  const recorded: EstimateInput[] = []
  const stored = [...rows]
  return {
    recorded,
    recordEstimate: async (entry) => {
      recorded.push(entry)
      stored.unshift({ ...entry, id: stored.length + 1, createdAt: Date.now() })
      return stored.length
    },
    recentEstimates: async () => stored,
    estimatesForContent: async (hash) => stored.filter((r) => r.contentHash === hash),
    health: async () => ({ available: true, schemaVersion: 1, quarantined: null, error: null }),
    listConfigurations: async () => [],
    getConfiguration: async () => null,
    saveConfiguration: async () => {},
    removeConfiguration: async () => false
  }
}

const brokenApi = (message: string): StorageApi =>
  new Proxy({} as StorageApi, {
    get: () => async () => {
      throw new Error(message)
    }
  })

const RESULT = { verdict: 'fits', quantity: 4 } as unknown as PackResult
const REQUEST = {} as PackRequest

/** Put the store in the state a user sees when an estimate is on screen. */
function withEstimate(result: PackResult = RESULT): void {
  useAppStore.getState().beginImport({ name: 'bracket.stp', sizeBytes: 1024 })
  useAppStore.getState().importSucceeded([], { elapsedMs: 5, partCount: 1, triangleCount: 2 }, 'hash-abc')
  useAppStore.getState().packSucceeded(result, REQUEST, 12)
}

beforeEach(() => {
  useAppStore.getState().resetImport()
  useAppStore.setState({ savedEstimates: [], storageError: null })
})

describe('the unit part travels with the receipt (2026-09-04)', () => {
  const part = (name: string): ImportedPart => ({
    name,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: null,
    indices: new Uint32Array([0, 1, 2])
  })
  const rowWith = (settings: unknown): EstimateRow => ({
    id: 1,
    fileName: 'a.stp',
    contentHash: 'h',
    settings,
    result: { mode: 'max-quantity', count: 3 },
    createdAt: 1
  })
  /** An estimate on screen for a file that has a part named `plate`. */
  const ready = (): void => {
    useAppStore.getState().beginImport({ name: 'as1.stp', sizeBytes: 1 })
    useAppStore
      .getState()
      .importSucceeded([part('plate'), part('nut')], { elapsedMs: 1, partCount: 2, triangleCount: 2 }, 'h')
    useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
  }

  // A row saved as "3 plates" restored against a session on the whole file
  // recomputed 1 — and a row saved as "1 assembly" restored against a plate
  // session recomputed 3 — with nothing in either reply saying what changed.
  // Overrides restored correctly beside it, which isolated the unit part as the
  // single input the receipt never carried.
  it('is written beside the overrides', async () => {
    const api = fakeApi()
    ready()
    useAppStore.getState().setUnitPartName('plate')
    expect(await saveEstimate(api)).toBe(true)
    expect((api.recorded[0].settings as { unitPartName: unknown }).unitPartName).toBe('plate')
  })

  it('is restored when the loaded file has that part, and pruned to the whole file when not', () => {
    ready()
    useAppStore.getState().setUnitPartName(null)
    restoreEstimateSettings(rowWith({ unitPartName: 'plate' }))
    expect(useAppStore.getState().unitPartName).toBe('plate')
    restoreEstimateSettings(rowWith({ unitPartName: 'flange' }))
    expect(useAppStore.getState().unitPartName).toBeNull()
  })

  it('an older row with no key restores the whole file — which is what it recorded', () => {
    ready()
    useAppStore.getState().setUnitPartName('plate')
    restoreEstimateSettings(rowWith({}))
    expect(useAppStore.getState().unitPartName).toBeNull()
  })
})

describe('saveEstimate', () => {
  it('files the estimate on screen, with the file identity that produced it', async () => {
    const api = fakeApi()
    withEstimate()

    expect(await saveEstimate(api)).toBe(true)
    expect(api.recorded).toHaveLength(1)
    expect(api.recorded[0].fileName).toBe('bracket.stp')
    expect(api.recorded[0].contentHash).toBe('hash-abc')
    expect(api.recorded[0].result).toBe(RESULT)
    // Settings PLUS the per-kind overrides (ADR-0018 §4). They ride alongside
    // rather than inside PackingSettings, because they are file-scoped and
    // folding them in would put them in presets and localStorage.
    expect(api.recorded[0].settings).toEqual({
      ...useAppStore.getState().settings,
      partWeightsG: useAppStore.getState().partWeightsG,
      // The unit part rides in the same blob since 2026-09-04 (ADR-0016 addendum).
      unitPartName: useAppStore.getState().unitPartName
    })
  })

  it('carries the per-kind weight overrides into the row', async () => {
    const api = fakeApi()
    withEstimate()
    useAppStore.getState().setPartWeight('bolt', 23)

    expect(await saveEstimate(api)).toBe(true)
    expect((api.recorded[0].settings as { partWeightsG: unknown }).partWeightsG).toEqual({
      bolt: 23
    })
  })

  it('saves once per press — not once per estimate', async () => {
    // The inverse of the old exactly-once guarantee. Two presses on the same
    // estimate are two deliberate acts, and the user may well want the second.
    const api = fakeApi()
    withEstimate()
    await saveEstimate(api)
    await saveEstimate(api)
    expect(api.recorded).toHaveLength(2)
  })

  it('does NOT save while a re-pack is in flight', async () => {
    // The panel keeps the previous estimate on screen (dimmed) while packing.
    // Filing that would be a receipt for an answer already superseded.
    const api = fakeApi()
    withEstimate()
    useAppStore.getState().packBegan()
    expect(await saveEstimate(api)).toBe(false)
    expect(api.recorded).toHaveLength(0)
  })

  it('does nothing when there is no estimate at all', async () => {
    const api = fakeApi()
    expect(await saveEstimate(api)).toBe(false)
    expect(api.recorded).toHaveLength(0)
    // Not an error: the button is disabled here, so this is a race, not a fault.
    expect(useAppStore.getState().storageError).toBeNull()
  })

  it('refreshes the list so a save is visible immediately', async () => {
    const api = fakeApi()
    withEstimate()
    await saveEstimate(api)
    expect(useAppStore.getState().savedEstimates).toHaveLength(1)
    expect(useAppStore.getState().savedEstimates[0].fileName).toBe('bracket.stp')
  })

  it('routes a storage failure to storageError rather than rejecting', async () => {
    withEstimate()
    const api = brokenApi('database is unavailable')
    await expect(saveEstimate(api)).resolves.toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
  })

  it('records an unhashable file rather than refusing to save it', async () => {
    // Hashing can fail; the row is still worth keeping, it just cannot be
    // threaded to other imports of the same geometry.
    const api = fakeApi()
    withEstimate()
    useAppStore.getState().importSucceeded([], { elapsedMs: 5, partCount: 1, triangleCount: 2 }, null)
    useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
    expect(await saveEstimate(api)).toBe(true)
    expect(api.recorded[0].contentHash).toBe('')
  })
})

describe('refreshSavedEstimates', () => {
  it('loads the list newest-first as the store gives it', async () => {
    const rows: EstimateRow[] = [
      { id: 2, fileName: 'b.stp', contentHash: 'h', settings: {}, result: {}, createdAt: 2 },
      { id: 1, fileName: 'a.stp', contentHash: 'h', settings: {}, result: {}, createdAt: 1 }
    ]
    await refreshSavedEstimates(fakeApi(rows))
    expect(useAppStore.getState().savedEstimates.map((r) => r.fileName)).toEqual(['b.stp', 'a.stp'])
  })

  it('reports a failure instead of leaving an empty list looking like no history', async () => {
    await refreshSavedEstimates(brokenApi('storage is unavailable'))
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
  })
})

describe('restoreEstimateSettings', () => {
  const row = (settings: unknown): EstimateRow => ({
    id: 1,
    fileName: 'a.stp',
    contentHash: 'h',
    settings,
    result: { verdict: 'from the past' },
    createdAt: 1
  })

  it('applies the saved settings to the live inputs', () => {
    useAppStore.getState().updateSettings({ maxWeightG: 1 })
    restoreEstimateSettings(row({ maxWeightG: 4242 }))
    expect(useAppStore.getState().settings.maxWeightG).toBe(4242)
  })

  it('NEVER restores the saved result (ADR-0016 §3)', () => {
    // The on-screen estimate must always be one the engine just computed: the
    // staleness dimming and the verdict wording both depend on it. A row is a
    // receipt, not a cache.
    useAppStore.getState().packSucceeded(RESULT, REQUEST, 12)
    restoreEstimateSettings(row({ maxWeightG: 4242 }))
    expect(useAppStore.getState().packResult).toBe(RESULT)
  })

  it('MERGES over current settings, like a preset load', () => {
    // A row written by an older build need not mention every field this build
    // has; replacing wholesale would leave those undefined and break the inputs.
    useAppStore.getState().updateSettings({ clearancePartMm: 5, maxWeightG: 100 })
    restoreEstimateSettings(row({ maxWeightG: 777 }))
    expect(useAppStore.getState().settings.maxWeightG).toBe(777)
    expect(useAppStore.getState().settings.clearancePartMm).toBe(5)
    expect(useAppStore.getState().settings.mode).toBeDefined()
  })

  // ADR-0018 §4: overrides restore by KIND, and only for kinds this file has.
  describe('per-kind weight overrides', () => {
    /** Two parts named so `bolt (2)` groups under `bolt`. */
    const parts = [
      { name: 'bolt', positions: new Float32Array(), normals: null, indices: new Uint32Array() },
      { name: 'bolt (2)', positions: new Float32Array(), normals: null, indices: new Uint32Array() }
    ]

    beforeEach(() => {
      useAppStore.getState().importSucceeded(parts, { elapsedMs: 1, partCount: 2, triangleCount: 0 }, 'h')
    })

    it('restores an override for a kind the loaded file has', () => {
      restoreEstimateSettings(row({ maxWeightG: 5, partWeightsG: { bolt: 23 } }))
      expect(useAppStore.getState().partWeightsG).toEqual({ bolt: 23 })
    })

    it('DROPS an override naming a kind this file lacks', () => {
      // A row saved against another assembly would otherwise leave invisible
      // state: an override with no row in the panel, repricing nothing.
      restoreEstimateSettings(row({ partWeightsG: { sprocket: 9 } }))
      expect(useAppStore.getState().partWeightsG).toEqual({})
    })

    it('clears existing overrides when the row has none', () => {
      useAppStore.getState().setPartWeight('bolt', 99)
      restoreEstimateSettings(row({ maxWeightG: 5 }))
      expect(useAppStore.getState().partWeightsG).toEqual({})
    })

    it('survives a row whose overrides are the wrong shape entirely', () => {
      // The blob is JSON from whatever build wrote it — a claim, not a promise.
      for (const bad of [null, 'bolt', 42, ['bolt', 1]]) {
        restoreEstimateSettings(row({ partWeightsG: bad }))
        expect(useAppStore.getState().partWeightsG).toEqual({})
      }
    })

    it('does not leak partWeightsG into settings', () => {
      restoreEstimateSettings(row({ partWeightsG: { bolt: 23 } }))
      expect('partWeightsG' in useAppStore.getState().settings).toBe(false)
    })
  })
})
