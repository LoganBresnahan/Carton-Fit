import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { ToolStorage } from './mcp/data'
import { openDatabase } from './db/open'
import { ConfigurationsStore } from './db/configurations'
import { EstimatesStore } from './db/estimates'
import {
  STORAGE_CHANNELS,
  type EstimateInput,
  type StorageHealth
} from '../shared/storage'

// The storage IPC surface (ADR-0007). `core/` and the renderer never touch the
// database; everything arrives here.

interface Storage {
  db: Database
  configurations: ConfigurationsStore
  estimates: EstimatesStore
  quarantined: string | null
  schemaVersion: number
}

let storage: Storage | null = null
let openError: string | null = null

/**
 * Open the database on first use, once, and remember a failure instead of
 * retrying on every call.
 *
 * LAZY AND NON-FATAL, deliberately. Packing estimates do not depend on storage
 * (VISION: drop a file, get an answer), so a database that cannot be opened
 * must degrade the save/history features rather than stop the app from
 * starting. It also keeps the dev loop working: better-sqlite3 is compiled for
 * whichever ABI packaged last, and `npm test` restores the Node one, so in dev
 * the module is often unloadable here (ADR-0013). A packaged build cannot hide
 * behind that — `e2e/native-module.spec.ts` fails loudly if the shipped app
 * cannot load it.
 */
function get(): Storage | null {
  if (storage) return storage
  if (openError !== null) return null

  try {
    const path = join(app.getPath('userData'), 'carton-fit.db')
    const opened = openDatabase(path)
    storage = {
      db: opened.db,
      configurations: new ConfigurationsStore(opened.db),
      estimates: new EstimatesStore(opened.db),
      quarantined: opened.quarantined,
      schemaVersion: opened.version
    }
    if (opened.quarantined) {
      console.warn(`[storage] unreadable database moved aside: ${opened.quarantined}`)
    }
    return storage
  } catch (error) {
    openError = (error as Error).message
    console.error('[storage] unavailable:', openError)
    return null
  }
}

/** Storage or a thrown error — for handlers that cannot do anything useful without it. */
function require_(): Storage {
  const s = get()
  if (!s) {
    // Surfaces in the renderer as a rejected invoke. Better than returning a
    // neutral-looking empty result, which would read as "you have no presets".
    throw new Error(`storage is unavailable: ${openError ?? 'database not opened'}`)
  }
  return s
}

export function registerStorageIpc(): void {
  ipcMain.handle(STORAGE_CHANNELS.health, (): StorageHealth => {
    const s = get()
    return {
      available: s !== null,
      schemaVersion: s?.schemaVersion ?? null,
      quarantined: s?.quarantined ?? null,
      error: s ? null : openError
    }
  })

  ipcMain.handle(STORAGE_CHANNELS.configurationsList, () => require_().configurations.list())

  ipcMain.handle(STORAGE_CHANNELS.configurationsGet, (_event, name: string) =>
    require_().configurations.get(name)
  )

  ipcMain.handle(STORAGE_CHANNELS.configurationsSave, (_event, name: string, settings: unknown) => {
    require_().configurations.save(name, settings)
  })

  ipcMain.handle(STORAGE_CHANNELS.configurationsRemove, (_event, name: string) =>
    require_().configurations.remove(name)
  )

  ipcMain.handle(STORAGE_CHANNELS.estimatesRecord, (_event, entry: EstimateInput) =>
    require_().estimates.record(entry)
  )

  ipcMain.handle(STORAGE_CHANNELS.estimatesRecent, (_event, limit?: number) =>
    require_().estimates.recent(limit)
  )

  ipcMain.handle(
    STORAGE_CHANNELS.estimatesForContent,
    (_event, contentHash: string, limit?: number) =>
      require_().estimates.forContent(contentHash, limit)
  )
}

/**
 * The reads the v3 MCP tools do (ADR-0029).
 *
 * Straight to main's own connection rather than back out through the renderer:
 * the lists are already here, and a round trip would only add a way for the
 * tool's answer and the panel's list to disagree. WRITES are deliberately not
 * here — saving a preset or an estimate means saving *what is on screen*, so
 * those go through the renderer's own functions over the drive bridge, where
 * ADR-0016's and ADR-0018's semantics already live.
 *
 * `require_` throws when storage is unavailable, and that message reaches the
 * AI client as the tool's error — which is right: "presets are broken" and
 * "you have no presets" must not look the same (ADR-0007). The interface
 * itself lives in mcp/data.ts, which the Electron-free server module can see.
 */
export const storageForTools: ToolStorage = {
  listConfigurations: () => require_().configurations.list(),
  recentEstimates: (limit) => require_().estimates.recent(limit),
  estimateById: (id) => require_().estimates.byId(id)
}

/** Close the handle on quit so WAL checkpoints and the file is left clean. */
export function closeStorage(): void {
  storage?.db.close()
  storage = null
}
