// The storage contract, shared by all three processes (ADR-0007).
//
// Main implements it, preload forwards it, the renderer consumes it — so the
// types live in one place rather than being restated (and drifting) at each
// hop. This file is TYPES AND CONSTANTS ONLY: it is imported into the renderer
// bundle, so anything with a runtime dependency on better-sqlite3 or Electron
// must stay out of it.
//
// Everything crossing IPC must survive structured cloning. All of these are
// plain objects, numbers and strings; `settings` and `result` are whatever the
// renderer put in, stored as JSON, so they must be JSON-round-trippable — no
// Dates, Maps, or class instances.

export const STORAGE_CHANNELS = {
  health: 'storage:health',
  configurationsList: 'storage:configurations:list',
  configurationsGet: 'storage:configurations:get',
  configurationsSave: 'storage:configurations:save',
  configurationsRemove: 'storage:configurations:remove',
  estimatesRecord: 'storage:estimates:record',
  estimatesRecent: 'storage:estimates:recent',
  estimatesForContent: 'storage:estimates:for-content'
} as const

/** A preset as the picker lists it — no settings blob, because a list does not need one. */
export interface ConfigurationSummary {
  readonly id: number
  readonly name: string
  readonly updatedAt: number
}

export interface ConfigurationRow {
  readonly id: number
  readonly name: string
  /** The settings snapshot, already parsed — the renderer's `PackingSettings`. */
  readonly settings: unknown
  readonly createdAt: number
  readonly updatedAt: number
}

export interface EstimateInput {
  readonly fileName: string
  /** Content hash of the imported model, so history survives a rename. */
  readonly contentHash: string
  readonly settings: unknown
  readonly result: unknown
}

export interface EstimateRow extends EstimateInput {
  readonly id: number
  readonly createdAt: number
}

/**
 * Whether storage actually works, and why not if it doesn't.
 *
 * This is a first-class part of the contract rather than an afterthought: the
 * database is opened lazily and is allowed to fail without taking the app down
 * (ADR-0007 — packing estimates do not depend on it), so the renderer needs a
 * way to ask instead of discovering it when a save silently does nothing.
 *
 * `quarantined` non-null means a corrupt database was moved aside and the user's
 * saved data is gone from the app's point of view — worth surfacing, not
 * swallowing.
 */
export interface StorageHealth {
  readonly available: boolean
  readonly schemaVersion: number | null
  readonly quarantined: string | null
  readonly error: string | null
}

/** The API the preload exposes on `window.api.storage`. */
export interface StorageApi {
  health(): Promise<StorageHealth>
  listConfigurations(): Promise<ConfigurationSummary[]>
  getConfiguration(name: string): Promise<ConfigurationRow | null>
  saveConfiguration(name: string, settings: unknown): Promise<void>
  removeConfiguration(name: string): Promise<boolean>
  recordEstimate(entry: EstimateInput): Promise<number>
  recentEstimates(limit?: number): Promise<EstimateRow[]>
  estimatesForContent(contentHash: string, limit?: number): Promise<EstimateRow[]>
}
