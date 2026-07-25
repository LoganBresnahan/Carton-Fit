import { useAppStore } from '../store'
import type { PackingSettings } from '../store'
import type { StorageApi } from '../../../shared/storage'

// Saved-configuration actions (ADR-0007). Async IPC lives here rather than in
// the store or a component: the store stays a synchronous spine of plain
// setters (ADR-0006), and components stay declarative.
//
// Every function is total — a storage failure lands in `storageError` for the
// UI to show, never as an unhandled rejection. Storage is optional by design
// (main opens the database lazily and tolerates failure), so "no presets"
// and "presets are broken" must be distinguishable to the user.

function api(injected?: StorageApi): StorageApi {
  return injected ?? window.api.storage
}

function fail(error: unknown): void {
  useAppStore.getState().setStorageError((error as Error)?.message ?? String(error))
}

/** Load the preset list into the store. Safe to call on mount and after writes. */
export async function refreshConfigurations(injected?: StorageApi): Promise<void> {
  try {
    useAppStore.getState().setConfigurations(await api(injected).listConfigurations())
  } catch (error) {
    fail(error)
  }
}

/** Save the CURRENT settings under `name`, then refresh the list. */
export async function saveConfiguration(name: string, injected?: StorageApi): Promise<boolean> {
  try {
    await api(injected).saveConfiguration(name, useAppStore.getState().settings)
    await refreshConfigurations(injected)
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

/**
 * Apply a saved preset to the live settings.
 *
 * Merged over the current settings rather than replacing them wholesale: a
 * preset saved by an older build may lack fields this build knows about, and
 * replacing would leave those `undefined` and break the inputs. Merging keeps
 * unknown-to-the-preset fields at their current values.
 */
export async function loadConfiguration(name: string, injected?: StorageApi): Promise<boolean> {
  try {
    const row = await api(injected).getConfiguration(name)
    if (!row) {
      useAppStore.getState().setStorageError(`No saved configuration called “${name}”.`)
      return false
    }
    useAppStore.getState().updateSettings(row.settings as Partial<PackingSettings>)
    useAppStore.getState().setStorageError(null)
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

export async function deleteConfiguration(name: string, injected?: StorageApi): Promise<boolean> {
  try {
    const removed = await api(injected).removeConfiguration(name)
    await refreshConfigurations(injected)
    return removed
  } catch (error) {
    fail(error)
    return false
  }
}
