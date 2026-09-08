import { beforeEach, describe, expect, it } from 'vitest'
import { activeCustomerFromStored, useAppStore } from '../src/renderer/src/store'
import { createCustomer, refreshCustomers } from '../src/renderer/src/storage/customers'
import { buildPackRequest } from '../src/renderer/src/packing/request'
import { canUndo, resetUndoHistory, startUndoHistory } from '../src/renderer/src/history/undo'
import type { CustomerRow, StorageApi } from '../src/shared/storage'

// The active customer (ADR-0035 §3): app state, its own key, off the undo
// stack, and NOTHING the engine computes reads it.

function fakeApi(customers: CustomerRow[] = []): StorageApi {
  const rows = [...customers]
  // A Proxy so the unused methods throw by name; a real property (an
  // override set by a test) wins over the generated ones.
  return new Proxy({} as StorageApi, {
    get: (target, key) => {
      const own = (target as unknown as Record<PropertyKey, unknown>)[key]
      if (own !== undefined) return own
      if (key === 'listCustomers') return async () => rows
      if (key === 'createCustomer')
        return async (name: string) => {
          const row = { id: rows.length + 1, name, createdAt: 1 }
          rows.push(row)
          return row
        }
      return async () => {
        throw new Error(`unexpected call ${String(key)}`)
      }
    }
  })
}

beforeEach(() => {
  useAppStore.getState().resetImport()
  useAppStore.setState({ customers: [], storageError: null })
  useAppStore.getState().setActiveCustomer(null)
})

describe('the persisted value', () => {
  it('is an integer id or house', () => {
    expect(activeCustomerFromStored(null)).toBeNull()
    expect(activeCustomerFromStored('{"activeCustomerId":3}')).toBe(3)
    expect(activeCustomerFromStored('{"activeCustomerId":"3"}')).toBeNull()
    expect(activeCustomerFromStored('{"activeCustomerId":1.5}')).toBeNull()
    expect(activeCustomerFromStored('not json')).toBeNull()
  })
})

describe('refreshCustomers', () => {
  it('loads the list and keeps a valid active customer', async () => {
    useAppStore.getState().setActiveCustomer(2)
    await refreshCustomers(
      fakeApi([
        { id: 1, name: 'Acme', createdAt: 1 },
        { id: 2, name: 'Beta', createdAt: 1 }
      ])
    )
    expect(useAppStore.getState().customers.map((c) => c.name)).toEqual(['Acme', 'Beta'])
    expect(useAppStore.getState().activeCustomerId).toBe(2)
  })

  it('falls back to house when the active customer is not in the list', async () => {
    useAppStore.getState().setActiveCustomer(9)
    await refreshCustomers(fakeApi([{ id: 1, name: 'Acme', createdAt: 1 }]))
    expect(useAppStore.getState().activeCustomerId).toBeNull()
  })
})

describe('createCustomer', () => {
  it('creates, re-lists, and starts working for the new one', async () => {
    const id = await createCustomer('Acme', fakeApi())
    expect(id).toBe(1)
    expect(useAppStore.getState().customers.map((c) => c.name)).toEqual(['Acme'])
    expect(useAppStore.getState().activeCustomerId).toBe(1)
  })

  it('a failure is reported and house stays active', async () => {
    const api = fakeApi()
    api.createCustomer = async () => {
      throw new Error('UNIQUE constraint failed: customers.name')
    }
    expect(await createCustomer('Acme', api)).toBeNull()
    expect(useAppStore.getState().storageError).toMatch(/UNIQUE|storage/)
    expect(useAppStore.getState().activeCustomerId).toBeNull()
  })
})

describe('a customer is a label, never an input', () => {
  it('the pack request is byte-identical under two customers', () => {
    const part = {
      name: 'plate',
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
      normals: null,
      indices: new Uint32Array([0, 1, 2, 0, 1, 3])
    }
    const build = (): string => {
      const s = useAppStore.getState()
      return JSON.stringify(
        buildPackRequest([part], s.settings, s.unitPartName, s.partWeightsG),
        (_key, value: unknown) => (ArrayBuffer.isView(value) ? Array.from(value as Float32Array) : value)
      )
    }
    useAppStore.getState().setActiveCustomer(1)
    const underAcme = build()
    useAppStore.getState().setActiveCustomer(2)
    const underBeta = build()
    useAppStore.getState().setActiveCustomer(null)
    expect(underAcme).toBe(underBeta)
    expect(underBeta).toBe(build())
  })

  it('switching customer is not an undo step', () => {
    const stop = startUndoHistory(() => 1000)
    try {
      useAppStore.getState().setActiveCustomer(1)
      useAppStore.getState().setActiveCustomer(null)
      expect(canUndo()).toBe(false)
      // …while an input still is, so the stack was live.
      useAppStore.getState().updateSettings({ maxWeightG: 2000 })
      expect(canUndo()).toBe(true)
    } finally {
      stop()
      resetUndoHistory()
    }
  })
})
