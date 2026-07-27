import { contextBridge, ipcRenderer } from 'electron'
import {
  STORAGE_CHANNELS,
  type ConfigurationRow,
  type ConfigurationSummary,
  type EstimateInput,
  type EstimateRow,
  type StorageApi,
  type StorageHealth
} from '../shared/storage'
import {
  EXPORT_CHANNELS,
  type ExportApi,
  type ExportSaveRequest,
  type ExportSaveResult
} from '../shared/exportFile'
import { UPDATE_CHANNELS, type UpdateApi, type UpdateInfo } from '../shared/update'

// The renderer's only route to the main process (ADR-0007 storage; ADR-0006
// keeps the renderer declarative).
//
// Channel names appear here and in main, never in the renderer: UI code calls
// methods, so a mistyped channel cannot reach it and the wire protocol can
// change without touching components. `../shared/storage` contributes types and
// the channel constants only — it has no runtime dependency on Electron or
// better-sqlite3, which is exactly why the renderer can import the same file.

const storage: StorageApi = {
  health: () => ipcRenderer.invoke(STORAGE_CHANNELS.health) as Promise<StorageHealth>,

  listConfigurations: () =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsList) as Promise<ConfigurationSummary[]>,

  getConfiguration: (name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsGet, name) as Promise<ConfigurationRow | null>,

  saveConfiguration: (name: string, settings: unknown) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsSave, name, settings) as Promise<void>,

  removeConfiguration: (name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsRemove, name) as Promise<boolean>,

  recordEstimate: (entry: EstimateInput) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesRecord, entry) as Promise<number>,

  recentEstimates: (limit?: number) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesRecent, limit) as Promise<EstimateRow[]>,

  estimatesForContent: (contentHash: string, limit?: number) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesForContent, contentHash, limit) as Promise<
      EstimateRow[]
    >
}

const exportFile: ExportApi = {
  save: (request: ExportSaveRequest) =>
    ipcRenderer.invoke(EXPORT_CHANNELS.save, request) as Promise<ExportSaveResult>
}

// Both calls are argument-free (ADR-0021): the renderer can ask what main
// found and ask it to open that page, but cannot name a URL for either.
const update: UpdateApi = {
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check) as Promise<UpdateInfo | null>,
  openReleasePage: () => ipcRenderer.invoke(UPDATE_CHANNELS.openRelease) as Promise<void>
}

const api = {
  platform: process.platform,
  storage,
  exportFile,
  update
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
