import { useAppStore } from '../store'
import { storageMessage } from './message'
import type { StorageApi } from '../../../shared/storage'

// Customers (ADR-0035). The list is main's; creating one is the person's act
// from the header, and no assistant reaches `createCustomer`. Same shape as
// the other storage services: total functions, failures to `storageError`.

function api(injected?: StorageApi): StorageApi {
  return injected ?? window.api.storage
}

function fail(error: unknown): void {
  useAppStore.getState().setStorageError(storageMessage(error))
}

/**
 * Load the customer list into the store. If the persisted active customer is
 * not in it (a database swapped under the app, a quarantined file), the app
 * falls back to house rather than working for a customer that does not exist.
 */
export async function refreshCustomers(injected?: StorageApi): Promise<void> {
  try {
    const customers = await api(injected).listCustomers()
    const state = useAppStore.getState()
    state.setCustomers(customers)
    if (
      state.activeCustomerId !== null &&
      !customers.some((c) => c.id === state.activeCustomerId)
    ) {
      state.setActiveCustomer(null)
    }
  } catch (error) {
    fail(error)
  }
}

/** Create a customer and start working for them. @returns the new id, or null. */
export async function createCustomer(
  name: string,
  injected?: StorageApi
): Promise<number | null> {
  try {
    const created = await api(injected).createCustomer(name)
    await refreshCustomers(injected)
    useAppStore.getState().setActiveCustomer(created.id)
    return created.id
  } catch (error) {
    fail(error)
    return null
  }
}
