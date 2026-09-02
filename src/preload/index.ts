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
import {
  THEME_CHANNELS,
  type ThemeApi,
  type ThemePreference,
  type ThemeState
} from '../shared/theme'
import {
  CLAUDE_CONNECT_CHANNELS,
  type ClaudeConnectApi,
  type ClaudeConnectStatus
} from '../shared/claudeConnect'
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

// The preference goes main-ward as a plain string and is validated there
// against the three-member union (ADR-0025 §4) — the renderer names a theme, it
// does not reach `nativeTheme`.
const theme: ThemeApi = {
  get: () => ipcRenderer.invoke(THEME_CHANNELS.get) as Promise<ThemeState>,
  set: (preference: ThemePreference) =>
    ipcRenderer.invoke(THEME_CHANNELS.set, preference) as Promise<ThemeState>
}

// Both calls are argument-free for the same reason the update pair is
// (ADR-0029, slice `connect-to-claude-button`): main owns the config path and
// the launch command, so page content can neither nominate a file for the app
// to write nor a program for Claude Desktop to run.
const claudeConnect: ClaudeConnectApi = {
  status: () => ipcRenderer.invoke(CLAUDE_CONNECT_CHANNELS.status) as Promise<ClaudeConnectStatus>,
  connect: () => ipcRenderer.invoke(CLAUDE_CONNECT_CHANNELS.connect) as Promise<ClaudeConnectStatus>
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
  claudeConnect,
  mcpDrive
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
