import { contextBridge, ipcRenderer } from 'electron'
import {
  STORAGE_CHANNELS,
  type ConfigurationRow,
  type ConfigurationSummary,
  type CustomerRow,
  type CustomerScope,
  type CustomerUsage,
  type EstimateInput,
  type EstimateRow,
  type LinkOffer,
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
import {
  THEME_CHANNELS,
  type ThemeApi,
  type ThemePreference,
  type ThemeState
} from '../shared/theme'
import {
  CONNECT_CHANNELS,
  type ClientStatus,
  type ConnectApi,
  type ConnectClientId
} from '../shared/connect'
import {
  MCP_DRIVE_CHANNELS,
  type DriveEnvelope,
  type DriveResponse,
  type McpDriveApi
} from '../shared/mcpDrive'

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

  listConfigurations: (customer?: CustomerScope) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsList, customer) as Promise<
      ConfigurationSummary[]
    >,

  getConfiguration: (name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsGet, name) as Promise<ConfigurationRow | null>,

  saveConfiguration: (name: string, settings: unknown, customerId?: number | null) =>
    ipcRenderer.invoke(
      STORAGE_CHANNELS.configurationsSave,
      name,
      settings,
      customerId ?? null
    ) as Promise<void>,

  setConfigurationCustomer: (name: string, customerId: number | null) =>
    ipcRenderer.invoke(
      STORAGE_CHANNELS.configurationsSetCustomer,
      name,
      customerId
    ) as Promise<boolean>,

  listCustomers: () => ipcRenderer.invoke(STORAGE_CHANNELS.customersList) as Promise<CustomerRow[]>,

  createCustomer: (name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.customersCreate, name) as Promise<CustomerRow>,

  renameCustomer: (id: number, name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.customersRename, id, name) as Promise<CustomerRow>,

  customerUsage: (id: number) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.customersUsage, id) as Promise<CustomerUsage>,

  removeCustomer: (id: number, moveTo: number | null) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.customersRemove, id, moveTo) as Promise<CustomerUsage>,

  removeConfiguration: (name: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.configurationsRemove, name) as Promise<boolean>,

  recordEstimate: (entry: EstimateInput) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesRecord, entry) as Promise<number>,

  recentEstimates: (limit?: number, customer?: CustomerScope) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesRecent, limit, customer) as Promise<
      EstimateRow[]
    >,

  removeEstimate: (id: number) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.estimatesRemove, id) as Promise<boolean>,

  estimatesForContent: (contentHash: string, limit?: number, customer?: CustomerScope) =>
    ipcRenderer.invoke(
      STORAGE_CHANNELS.estimatesForContent,
      contentHash,
      limit,
      customer
    ) as Promise<EstimateRow[]>,

  estimatesForDocument: (contentHash: string, limit?: number, customer?: CustomerScope) =>
    ipcRenderer.invoke(
      STORAGE_CHANNELS.estimatesForDocument,
      contentHash,
      limit,
      customer
    ) as Promise<EstimateRow[]>,

  linkOffer: (contentHash: string, fileName: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.documentsLinkOffer, contentHash, fileName) as Promise<
      LinkOffer | null
    >,

  linkDocumentVersion: (contentHash: string, documentHash: string) =>
    ipcRenderer.invoke(STORAGE_CHANNELS.documentsLink, contentHash, documentHash) as Promise<void>
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

// The preference goes main-ward as a plain string and is validated there
// against the three-member union (ADR-0025 §4) — the renderer names a theme, it
// does not reach `nativeTheme`.
const theme: ThemeApi = {
  get: () => ipcRenderer.invoke(THEME_CHANNELS.get) as Promise<ThemeState>,
  set: (preference: ThemePreference) =>
    ipcRenderer.invoke(THEME_CHANNELS.set, preference) as Promise<ThemeState>
}

// The connect surface (ADR-0030). The one argument that crosses here is a
// client id, and it is a NAME, not a mechanism: main looks it up in the
// registry it populated, so page content still cannot nominate a file for the
// app to write nor a program for a client to run (ADR-0029's property, kept by
// lookup instead of by having no argument at all).
const connect: ConnectApi = {
  status: () => ipcRenderer.invoke(CONNECT_CHANNELS.status) as Promise<ClientStatus[]>,
  connect: (id: ConnectClientId) =>
    ipcRenderer.invoke(CONNECT_CHANNELS.connect, id) as Promise<ClientStatus>
}

// The drive bridge's renderer end (ADR-0029 v2) — the one channel pair where
// MAIN asks and the renderer answers. The handler is installed by
// mcp/driveHost.ts at startup; `ready` is what tells main it may start asking.
const mcpDrive: McpDriveApi = {
  onRequest: (handler: (envelope: DriveEnvelope) => void) => {
    ipcRenderer.on(MCP_DRIVE_CHANNELS.request, (_event, envelope: DriveEnvelope) =>
      handler(envelope)
    )
  },
  respond: (response: DriveResponse) => ipcRenderer.send(MCP_DRIVE_CHANNELS.response, response),
  ready: () => ipcRenderer.send(MCP_DRIVE_CHANNELS.ready)
}

const api = {
  platform: process.platform,
  storage,
  exportFile,
  update,
  theme,
  connect,
  mcpDrive
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
