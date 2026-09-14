import { estimateSummary } from '../../renderer/src/packing/summary'
import type { ConfigurationSummary, EstimateRow,
  CustomerRow,
  CustomerScope
} from '../../shared/storage'

// The v3 DATA tier's reports (ADR-0029, slice `v3-data-tools`): presets and
// saved estimates, worded for a client that cannot see the panels they come
// from.
//
// Pure and Electron-free, like appState.ts — the rows arrive from main's own
// database (storage.ts's `storageForTools`), and everything about turning one
// into a sentence is here so it can be tested without one.
//
// `estimateSummary` is the SAME function the saved-estimates panel renders
// (ADR-0016), deliberately: a receipt Claude reads out and a receipt the person
// sees on screen must be the same sentence, and that function already carries
// the defensiveness a row written by an older build needs.

/**
 * What the v3 tools need from the database.
 *
 * Declared HERE rather than in main's storage.ts — the same reason `DriveBridge`
 * is declared in shared/mcpDrive.ts: server.ts must be able to type against it
 * without pulling `electron` (and better-sqlite3 behind it) into the headless
 * entry's import graph. storage.ts implements it.
 *
 * Reads only. A failure throws with the storage message, and that becomes the
 * tool's error — "presets are broken" and "you have no presets" must not look
 * the same (ADR-0007).
 */
/** The list tools' scope (ADR-0034 §3): the loaded document, or everything. */
export type EstimatesScope = 'model' | 'all'

export interface ToolStorage {
  listConfigurations(customer?: CustomerScope): ConfigurationSummary[]
  recentEstimates(limit?: number, customer?: CustomerScope): EstimateRow[]
  /** The loaded document's receipts, across its linked versions (ADR-0034 §3). */
  estimatesForDocument(contentHash: string, limit?: number, customer?: CustomerScope): EstimateRow[]
  estimateById(id: number): EstimateRow | null
  /** Row counts under a filter, for saying how many the filter withheld
   *  (ADR-0035 amendment 1). `contentHash` null counts every document. */
  countEstimates(contentHash: string | null, customer?: CustomerScope): number
  countConfigurations(customer?: CustomerScope): number
  /** Every customer (ADR-0035). Creating one is not here: it is the person's act. */
  listCustomers(): CustomerRow[]
}

/** Which customers' rows a list tool answers with (ADR-0035 §4). */
export type CustomerFilter = 'active' | 'all'

/** id → name, for putting a name on a row's tag. */
export type CustomerNames = ReadonlyMap<number, string>

function nameOf(names: CustomerNames, id: number | null): string | null {
  if (id === null) return null
  return names.get(id) ?? `customer #${id}`
}

/**
 * A stored timestamp as ISO 8601 UTC.
 *
 * ISO rather than the app's own "3:42 PM / Mar 4" formatting, which is built
 * for someone glancing at a list in their own locale; a client reading this may
 * be reasoning about ordering or quoting a date back, and an unambiguous
 * absolute instant is what that needs.
 *
 * `created_at`/`updated_at` are NOT NULL integer columns, so 'unknown' is
 * unreachable in practice — it exists because a list of the user's own data
 * must not be the thing that throws.
 */
export function isoTime(epochMs: number): string {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : 'unknown'
}

export interface PresetsReport {
  /** Which rows these are (ADR-0035 §4). */
  customer: CustomerFilter
  /** How many rows the customer filter hid (ADR-0035 amendment 1); 0 under `'all'`. */
  withheldByCustomer: number
  presets: Array<{ name: string; savedAt: string; customer: string | null }>
}

export function presetsReport(
  rows: readonly ConfigurationSummary[],
  customer: CustomerFilter = 'all',
  names: CustomerNames = new Map(),
  withheldByCustomer = 0
): PresetsReport {
  return {
    customer,
    withheldByCustomer,
    presets: rows.map((row) => ({
      name: row.name,
      savedAt: isoTime(row.updatedAt),
      customer: nameOf(names, row.customerId)
    }))
  }
}

export interface SavedEstimatesReport {
  /** Which rows these are (ADR-0029 amendment 8). */
  scope: EstimatesScope
  /** Which customers' (ADR-0035 §4). */
  customer: CustomerFilter
  /** How many rows in this scope the customer filter hid (ADR-0035 amendment 1); 0 under `'all'`. */
  withheldByCustomer: number
  /** How many rows `limit` cut off after both filters (21st dogfood, rule 8):
   *  the third axis that can hide a row, and the one that said nothing. */
  withheldByLimit: number
  estimates: Array<{
    id: number
    file: string
    savedAt: string
    customer: string | null
    summary: string
  }>
}

export function savedEstimatesReport(
  rows: readonly EstimateRow[],
  scope: EstimatesScope = 'all',
  customer: CustomerFilter = 'all',
  names: CustomerNames = new Map(),
  withheldByCustomer = 0,
  withheldByLimit = 0
): SavedEstimatesReport {
  return {
    scope,
    customer,
    withheldByCustomer,
    withheldByLimit,
    estimates: rows.map((row) => ({
      id: row.id,
      file: row.fileName,
      savedAt: isoTime(row.createdAt),
      customer: nameOf(names, row.customerId),
      summary: estimateSummary(row)
    }))
  }
}
