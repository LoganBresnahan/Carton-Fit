import { useAppStore } from '../store'
import { storageMessage } from './message'
import { refreshConfigurations } from './configurations'
import { refreshSavedEstimates } from './estimates'
import type { CustomerUsage, StorageApi } from '../../../shared/storage'

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

/** Rename a customer (ADR-0035 amendment 2). Both lists print the name beside
 *  a row, so they re-read it. @returns whether it took. */
export async function renameCustomer(
  id: number,
  name: string,
  injected?: StorageApi
): Promise<boolean> {
  try {
    await api(injected).renameCustomer(id, name)
    await refreshCustomers(injected)
    await Promise.all([refreshConfigurations(injected), refreshSavedEstimates(injected)])
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

/** What the delete dialog says before it asks where the rows go. */
export async function customerUsage(
  id: number,
  injected?: StorageApi
): Promise<CustomerUsage | null> {
  try {
    return await api(injected).customerUsage(id)
  } catch (error) {
    fail(error)
    return null
  }
}

/**
 * Delete a customer by moving what it tagged to `moveTo` (null = house). If
 * it was the active customer, `refreshCustomers` falls the app back to house,
 * the same path a customer missing from the list has always taken.
 */
export async function deleteCustomer(
  id: number,
  moveTo: number | null,
  injected?: StorageApi
): Promise<boolean> {
  try {
    await api(injected).removeCustomer(id, moveTo)
    await refreshCustomers(injected)
    await Promise.all([refreshConfigurations(injected), refreshSavedEstimates(injected)])
    return true
  } catch (error) {
    fail(error)
    return false
  }
}
