import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'
import { useAppStore } from '../src/renderer/src/store'
import {
  acceptLinkOffer,
  declineLinkOffer,
  deleteEstimate,
  refreshLinkOffer,
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
      stored.unshift({
        ...entry,
        id: stored.length + 1,
        createdAt: Date.now(),
        customerId: entry.customerId ?? null
      })
      return stored.length
    },
    recentEstimates: async () => stored,
    removeEstimate: async (id) => {
      const at = stored.findIndex((r) => r.id === id)
      if (at < 0) return false
      stored.splice(at, 1)
      return true
    },
    estimatesForContent: async (hash) => stored.filter((r) => r.contentHash === hash),
    // The fake has no alias table: a document is one hash until a test links.
    estimatesForDocument: async (hash) => stored.filter((r) => r.contentHash === hash),
    linkOffer: async () => null,
    linkDocumentVersion: async () => {},
    setConfigurationCustomer: async () => false,
    listCustomers: async () => [],
    createCustomer: async (name) => ({ id: 1, name, createdAt: 1, customerId: null }),
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
  useAppStore.setState({
    savedEstimates: [],
    storageError: null,
    estimatesScope: 'model',
    linkOffer: null
  })
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
    createdAt: 1,
    customerId: null
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

// Delete (ADR-0034 §4): the person's act, from the panel, never from the wire.
describe('deleteEstimate', () => {
  const row = (id: number): EstimateRow => ({
    id,
    fileName: 'a.stp',
    contentHash: 'h',
    settings: {},
    result: {},
    createdAt: id,
    customerId: null
  })

  it('removes the row and re-lists', async () => {
    const api = fakeApi([row(2), row(1)])
    await refreshSavedEstimates(api)
    expect(await deleteEstimate(2, api)).toBe(true)
    expect(useAppStore.getState().savedEstimates.map((r) => r.id)).toEqual([1])
  })

  it('tells "never existed" from "gone", and neither is an error', async () => {
    const api = fakeApi([row(1)])
    expect(await deleteEstimate(99, api)).toBe(false)
    expect(useAppStore.getState().storageError).toBeNull()
    expect(useAppStore.getState().savedEstimates.map((r) => r.id)).toEqual([1])
  })

  it('a failed delete is reported and the list is left as it was', async () => {
    const api = fakeApi([row(1)])
    await refreshSavedEstimates(api)
    api.removeEstimate = async () => {
      throw new Error('storage is unavailable')
    }
    expect(await deleteEstimate(1, api)).toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
    expect(useAppStore.getState().savedEstimates.map((r) => r.id)).toEqual([1])
  })
})

describe('refreshSavedEstimates', () => {
  it('loads the list newest-first as the store gives it', async () => {
    const rows: EstimateRow[] = [
      { id: 2, fileName: 'b.stp', contentHash: 'h', settings: {}, result: {}, createdAt: 2, customerId: null },
      { id: 1, fileName: 'a.stp', contentHash: 'h', settings: {}, result: {}, createdAt: 1, customerId: null }
    ]
    await refreshSavedEstimates(fakeApi(rows))
    expect(useAppStore.getState().savedEstimates.map((r) => r.fileName)).toEqual(['b.stp', 'a.stp'])
  })

  // ADR-0034 §3: the list is scoped to the loaded document by content hash;
  // *All* is the whole table; nothing is hidden from *All*.
  describe('is scoped to the loaded model (ADR-0034 §3)', () => {
    const row = (id: number, fileName: string, contentHash: string): EstimateRow => ({
      id,
      fileName,
      contentHash,
      settings: {},
      result: {},
      createdAt: id,
      customerId: null
    })
    // Two parts, one of which shares its NAME with a third row under a
    // different hash — the case name-matching would merge and hash identity
    // must keep apart.
    const rows = [
      row(3, 'bracket.stp', 'hash-other'),
      row(2, 'plate.stp', 'hash-b'),
      row(1, 'bracket.stp', 'hash-a')
    ]
    const loaded = (name: string, hash: string | null): void => {
      useAppStore.getState().beginImport({ name, sizeBytes: 1 })
      useAppStore
        .getState()
        .importSucceeded([], { elapsedMs: 1, partCount: 1, triangleCount: 1 }, hash)
    }
    const listed = (): number[] => useAppStore.getState().savedEstimates.map((r) => r.id)

    it("lists the loaded document's rows by hash, never by name", async () => {
      loaded('bracket.stp', 'hash-a')
      await refreshSavedEstimates(fakeApi(rows))
      expect(listed()).toEqual([1])
    })

    it('follows a load to the new document', async () => {
      loaded('bracket.stp', 'hash-a')
      await refreshSavedEstimates(fakeApi(rows))
      loaded('plate.stp', 'hash-b')
      await refreshSavedEstimates(fakeApi(rows))
      expect(listed()).toEqual([2])
    })

    it('All shows every row, with a document loaded', async () => {
      loaded('bracket.stp', 'hash-a')
      useAppStore.getState().setEstimatesScope('all')
      await refreshSavedEstimates(fakeApi(rows))
      expect(listed()).toEqual([3, 2, 1])
    })

    it('with nothing loaded there is nothing to scope to: the full list', async () => {
      await refreshSavedEstimates(fakeApi(rows))
      expect(listed()).toEqual([3, 2, 1])
    })

    it('never queries an empty hash — a file whose hashing failed lists everything', async () => {
      const api = fakeApi([row(4, 'unhashed.stp', ''), ...rows])
      let askedFor: string | null = null
      api.estimatesForDocument = async (hash) => {
        askedFor = hash
        return []
      }
      loaded('unhashed.stp', null)
      await refreshSavedEstimates(api)
      expect(askedFor).toBeNull()
      expect(listed()).toEqual([4, 3, 2, 1])
    })

    it('a reply to an older scope does not overwrite the newer list', async () => {
      const api = fakeApi(rows)
      let release: (rows: EstimateRow[]) => void = () => {}
      api.estimatesForDocument = () => new Promise((resolve) => (release = resolve))
      loaded('bracket.stp', 'hash-a')
      const slow = refreshSavedEstimates(api)
      // The user widens to All while the scoped query is still in flight.
      useAppStore.getState().setEstimatesScope('all')
      await refreshSavedEstimates(api)
      expect(listed()).toEqual([3, 2, 1])
      release([rows[2]])
      await slow
      expect(listed()).toEqual([3, 2, 1])
    })
  })

  it('reports a failure instead of leaving an empty list looking like no history', async () => {
    await refreshSavedEstimates(brokenApi('storage is unavailable'))
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
  })
})

// The link offer (ADR-0034 §3): the rule is main's, the answer is the
// person's, and the renderer only carries the question to the panel.
describe('the link offer', () => {
  const offer = { contentHash: 'rev-b', documentHash: 'rev-a', fileName: 'as1.stp', count: 3 }
  const loaded = (name: string, hash: string | null): void => {
    useAppStore.getState().beginImport({ name, sizeBytes: 1 })
    useAppStore
      .getState()
      .importSucceeded([], { elapsedMs: 1, partCount: 1, triangleCount: 1 }, hash)
  }

  it('asks main with the loaded hash and name, and shows what comes back', async () => {
    const api = fakeApi()
    let asked: [string, string] | null = null
    api.linkOffer = async (hash, name) => {
      asked = [hash, name]
      return offer
    }
    loaded('as1.stp', 'rev-b')
    await refreshLinkOffer(api)
    expect(asked).toEqual(['rev-b', 'as1.stp'])
    expect(useAppStore.getState().linkOffer).toEqual(offer)
  })

  it('with nothing to scope to there is no question, and a stale offer is cleared', async () => {
    useAppStore.setState({ linkOffer: offer })
    const api = fakeApi()
    api.linkOffer = async () => {
      throw new Error('must not be asked')
    }
    await refreshLinkOffer(api)
    expect(useAppStore.getState().linkOffer).toBeNull()
  })

  it('an answer about a file that is no longer loaded is dropped', async () => {
    const api = fakeApi()
    let release: (o: typeof offer) => void = () => {}
    api.linkOffer = () => new Promise((resolve) => (release = resolve))
    loaded('as1.stp', 'rev-b')
    const slow = refreshLinkOffer(api)
    loaded('plate.stp', 'plate-1')
    release(offer)
    await slow
    expect(useAppStore.getState().linkOffer).toBeNull()
  })

  it('Link writes the alias, clears the offer and re-lists under the widened document', async () => {
    const api = fakeApi([
      { id: 1, fileName: 'as1.stp', contentHash: 'rev-a', settings: {}, result: {}, createdAt: 1, customerId: null }
    ])
    const links: [string, string][] = []
    api.linkDocumentVersion = async (c, d) => {
      links.push([c, d])
    }
    // Once linked, the fake's document query answers for the set.
    api.estimatesForDocument = async (hash) =>
      links.some(([c, d]) => c === hash && d === 'rev-a') ? api.recentEstimates() : []
    loaded('as1.stp', 'rev-b')
    useAppStore.setState({ linkOffer: offer })
    await refreshSavedEstimates(api)
    expect(useAppStore.getState().savedEstimates).toEqual([])

    await acceptLinkOffer(api)
    expect(links).toEqual([['rev-b', 'rev-a']])
    expect(useAppStore.getState().linkOffer).toBeNull()
    expect(useAppStore.getState().savedEstimates.map((r) => r.id)).toEqual([1])
  })

  it('Keep separate writes nothing', async () => {
    const api = fakeApi()
    api.linkDocumentVersion = async () => {
      throw new Error('must not be written')
    }
    useAppStore.setState({ linkOffer: offer })
    declineLinkOffer()
    expect(useAppStore.getState().linkOffer).toBeNull()
    expect(useAppStore.getState().storageError).toBeNull()
  })

  it('a failed link is reported and the offer stays for a retry', async () => {
    const api = fakeApi()
    api.linkDocumentVersion = async () => {
      throw new Error('storage is unavailable')
    }
    useAppStore.setState({ linkOffer: offer })
    await acceptLinkOffer(api)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
    expect(useAppStore.getState().linkOffer).toEqual(offer)
  })
})

describe('restoreEstimateSettings', () => {
  const row = (settings: unknown): EstimateRow => ({
    id: 1,
    fileName: 'a.stp',
    contentHash: 'h',
    settings,
    result: { verdict: 'from the past' },
    createdAt: 1,
    customerId: null
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
