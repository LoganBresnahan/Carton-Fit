import type { EstimateRow } from './storage'
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
  // The v3 DATA tier (slice `v3-data-tools`). Only the WRITES and the two
  // restores cross the bridge: reading the lists is a database query main can
  // do itself, but saving means saving *what is on screen*, and applying means
  // going through the store's own actions so one AI edit stays one undo step
  // (ADR-0016 §2) — exactly the rule the v2 tier follows.
  | { type: 'save_preset'; name: string }
  | { type: 'apply_preset'; name: string; units?: Partial<OutputUnits> }
  | { type: 'save_estimate' }
  /** The row is fetched by MAIN and passed whole, so the renderer restores the
   *  same bytes the list reported rather than looking an id up a second time. */
  | { type: 'restore_estimate'; row: EstimateRow; units?: Partial<OutputUnits> }
  | { type: 'export_estimate'; format: ExportFormat }

/** What `export_estimate` can produce — the two file exports ADR-0017 defines,
 *  minus the PNG, which `capture_view` already returns as an image. */
export type ExportFormat = 'csv' | 'summary'

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
  /** What loading a model threw away, when that is what produced this outcome
   *  (ADR-0029 amendment 6, 4th dogfood). `load_model` has always cleared the
   *  unit part and the per-kind overrides — kind names belong to the file that
   *  was open — and has said so in its description since the third pass. The
   *  description is a rule; this is the receipt, and two readers asked for it
   *  by name. Present only on a load, and present even when it cleared
   *  nothing, because "nothing was in force" is the answer to the same
   *  question. */
  cleared?: ClearedByLoad
}

/** The unit part and overrides a `load_model` dropped, named rather than
 *  implied by their absence from the state that follows. */
export interface ClearedByLoad {
  /** The unit part that was in force, or null if the whole file was the unit. */
  unitPart: string | null
  /** Kinds whose hand-typed weights were dropped, in the order they were set. */
  overriddenKinds: readonly string[]
}

export type DriveResult =
  | { kind: 'outcome'; outcome: DriveOutcome }
  | { kind: 'estimate'; estimate: EstimateAvailability }
  | { kind: 'image'; pngBase64: string }
  /** A write the renderer performed; main answers with the resulting LIST,
   *  which it re-reads from the database it owns. */
  | { kind: 'written' }
  | { kind: 'text'; format: ExportFormat; suggestedName: string; text: string }

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
