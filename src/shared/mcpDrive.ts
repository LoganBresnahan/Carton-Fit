import type { SetInputsRequest } from '../main/mcp/inputs'
import type { EstimateReport } from '../main/mcp/estimate'
import type { AppStateReport } from '../main/mcp/appState'
import type { OutputUnits } from '../main/mcp/wire'

// The drive bridge's wire (ADR-0029 v2, slice `v2-drive-tools`): the MCP
// server lives in MAIN, but the store, the auto-pack subscription, the undo
// stack and the capture seam are all renderer-side — so drive tools cross the
// process boundary as a request/response pair over one channel each way, a NEW
// IPC direction (main asks, renderer answers; every prior channel points the
// other way).
//
// Like shared/storage.ts, this file carries types and channel names only — no
// Electron, no store — which is exactly what lets preload, main and the
// renderer all import the same contract. The types it references
// (EstimateReport, AppStateReport, SetInputsRequest) come from the pure mcp
// modules, so the renderer building a report and main publishing its schema
// cannot drift apart.

export const MCP_DRIVE_CHANNELS = {
  /** main → renderer: a DriveEnvelope. */
  request: 'mcp:drive:request',
  /** renderer → main: a DriveResponse. */
  response: 'mcp:drive:response',
  /** renderer → main, once at startup: the drive host is listening. */
  ready: 'mcp:drive:ready'
} as const

export type DriveAction =
  | { type: 'load_model'; name: string; bytes: Uint8Array; units?: Partial<OutputUnits> }
  | { type: 'set_inputs'; input: SetInputsRequest; unitPart?: string | null; units?: Partial<OutputUnits> }
  | { type: 'set_part_weight'; partKind: string; grams: number | null; units?: Partial<OutputUnits> }
  | { type: 'get_estimate'; units?: Partial<OutputUnits> }
  | { type: 'get_app_state'; units?: Partial<OutputUnits> }
  | { type: 'capture_view'; view?: 'model' | 'packed' }

/** An estimate that either exists or says WHY it does not — the same
 *  absence-with-reason rule the v1 wire schemas follow (phase-2 addendum). */
export type EstimateAvailability =
  | { available: true; report: EstimateReport }
  | { available: false; reason: string }

/** What a mutating drive action (and get_app_state) answers with: where the
 *  app now stands, plus the estimate auto-run produced for it. */
export interface DriveOutcome {
  state: AppStateReport
  estimate: EstimateAvailability
}

export type DriveResult =
  | { kind: 'outcome'; outcome: DriveOutcome }
  | { kind: 'estimate'; estimate: EstimateAvailability }
  | { kind: 'image'; pngBase64: string }

export interface DriveEnvelope {
  id: number
  action: DriveAction
}

export type DriveResponse =
  | { id: number; ok: true; result: DriveResult }
  /** A call the app refused or could not complete; `error` is what the AI
   *  client reads out loud, so it is worded as advice, not a stack trace. */
  | { id: number; ok: false; error: string }

/** What the server needs from the bridge — defined HERE, not in main's
 *  driveBridge.ts, so the (Electron-free) server module can type against it
 *  while the headless entry never pulls Electron into its graph. */
export interface DriveBridge {
  call(action: DriveAction, timeoutMs?: number): Promise<DriveResult>
}

/** The preload surface for the drive host. */
export interface McpDriveApi {
  onRequest(handler: (envelope: DriveEnvelope) => void): void
  respond(response: DriveResponse): void
  /** Announce the handler is installed; main defers the first call until then. */
  ready(): void
}
