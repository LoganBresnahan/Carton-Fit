import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../src/renderer/src/store'
import {
  deleteConfiguration,
  loadConfiguration,
  refreshConfigurations,
  saveConfiguration
} from '../src/renderer/src/storage/configurations'
import type { ConfigurationRow, ConfigurationSummary, StorageApi } from '../src/shared/storage'

// Saved-configuration actions (ADR-0007). These own the async IPC so the store
// stays synchronous (ADR-0006); what matters is that every failure lands in
// `storageError` instead of an unhandled rejection, and that loading a preset
// cannot corrupt live settings.

function fakeApi(rows: ConfigurationRow[] = []): StorageApi {
  const store = new Map(rows.map((r) => [r.name, r]))
  let nextId = store.size + 1
  return {
    health: async () => ({ available: true, schemaVersion: 1, quarantined: null, error: null }),
    listConfigurations: async (): Promise<ConfigurationSummary[]> =>
      [...store.values()].map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt })),
    getConfiguration: async (name) => store.get(name) ?? null,
    saveConfiguration: async (name, settings) => {
      store.set(name, { id: nextId++, name, settings, createdAt: 1, updatedAt: 1 })
    },
    removeConfiguration: async (name) => store.delete(name),
    recordEstimate: async () => 1,
    recentEstimates: async () => [],
    estimatesForContent: async () => []
  }
}

const brokenApi = (message: string): StorageApi =>
  new Proxy({} as StorageApi, {
    get: () => async () => {
      throw new Error(message)
    }
  })

beforeEach(() => {
  useAppStore.setState({ configurations: [], storageError: null })
  useAppStore.getState().updateSettings({ maxWeightG: 15876, clearancePartMm: 0 })
})

describe('saved configurations', () => {
  it('saves the live settings and refreshes the list', async () => {
    const api = fakeApi()
    useAppStore.getState().updateSettings({ maxWeightG: 4242 })

    expect(await saveConfiguration('Preset A', api)).toBe(true)
    expect(useAppStore.getState().configurations.map((c) => c.name)).toEqual(['Preset A'])

    const row = await api.getConfiguration('Preset A')
    expect((row?.settings as { maxWeightG: number }).maxWeightG).toBe(4242)
  })

  it('applies a loaded preset to live settings', async () => {
    const api = fakeApi()
    useAppStore.getState().updateSettings({ maxWeightG: 1 })
    await saveConfiguration('Heavy', api)

    useAppStore.getState().updateSettings({ maxWeightG: 99999 })
    expect(await loadConfiguration('Heavy', api)).toBe(true)
    expect(useAppStore.getState().settings.maxWeightG).toBe(1)
  })

  it('MERGES a partial preset rather than replacing settings wholesale', async () => {
    // A preset written by an older build lacks fields this build knows about.
    // Replacing would leave them undefined and break the inputs; merging keeps
    // the current value for anything the preset does not mention.
    const api = fakeApi([
      {
        id: 1,
        name: 'Legacy',
        settings: { maxWeightG: 777 },
        createdAt: 1,
        updatedAt: 1
      }
    ])
    useAppStore.getState().updateSettings({ clearancePartMm: 5 })

    expect(await loadConfiguration('Legacy', api)).toBe(true)
    expect(useAppStore.getState().settings.maxWeightG).toBe(777)
    expect(useAppStore.getState().settings.clearancePartMm).toBe(5)
    expect(useAppStore.getState().settings.mode).toBeDefined()
  })

  it('reports a missing preset instead of silently doing nothing', async () => {
    expect(await loadConfiguration('ghost', fakeApi())).toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/ghost/)
  })

  it('deletes and refreshes', async () => {
    const api = fakeApi()
    await saveConfiguration('Temp', api)
    expect(await deleteConfiguration('Temp', api)).toBe(true)
    expect(useAppStore.getState().configurations).toEqual([])
  })

  it('routes every storage failure into storageError, never a rejection', async () => {
    const api = brokenApi('database is unavailable')

    await expect(refreshConfigurations(api)).resolves.toBeUndefined()
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)

    useAppStore.getState().setStorageError(null)
    expect(await saveConfiguration('x', api)).toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)

    useAppStore.getState().setStorageError(null)
    expect(await loadConfiguration('x', api)).toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)

    useAppStore.getState().setStorageError(null)
    expect(await deleteConfiguration('x', api)).toBe(false)
    expect(useAppStore.getState().storageError).toMatch(/unavailable/)
  })

  it('clears a stale error once storage works again', async () => {
    useAppStore.getState().setStorageError('previous failure')
    await refreshConfigurations(fakeApi())
    expect(useAppStore.getState().storageError).toBeNull()
  })
})
