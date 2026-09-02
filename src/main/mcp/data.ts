import { estimateSummary } from '../../renderer/src/packing/summary'
import type { ConfigurationSummary, EstimateRow } from '../../shared/storage'

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
export interface ToolStorage {
  listConfigurations(): ConfigurationSummary[]
  recentEstimates(limit?: number): EstimateRow[]
  estimateById(id: number): EstimateRow | null
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
  presets: Array<{ name: string; savedAt: string }>
}

export function presetsReport(rows: readonly ConfigurationSummary[]): PresetsReport {
  return { presets: rows.map((row) => ({ name: row.name, savedAt: isoTime(row.updatedAt) })) }
}

export interface SavedEstimatesReport {
  estimates: Array<{ id: number; file: string; savedAt: string; summary: string }>
}

export function savedEstimatesReport(rows: readonly EstimateRow[]): SavedEstimatesReport {
  return {
    estimates: rows.map((row) => ({
      id: row.id,
      file: row.fileName,
      savedAt: isoTime(row.createdAt),
      summary: estimateSummary(row)
    }))
  }
}
