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
  estimatesForContent: 'storage:estimates:for-content',
  estimatesRemove: 'storage:estimates:remove',
  estimatesForDocument: 'storage:estimates:for-document',
  documentsLinkOffer: 'storage:documents:link-offer',
  documentsLink: 'storage:documents:link',
  configurationsSetCustomer: 'storage:configurations:set-customer',
  customersList: 'storage:customers:list',
  customersCreate: 'storage:customers:create'
} as const

/**
 * Which customer's rows a list shows (ADR-0035 §3): the active customer's
 * PLUS house (rows with no customer), or — when the scope is omitted —
 * everything. `activeId` null means house is the active customer, so the
 * list is house only.
 */
export interface CustomerScope {
  readonly activeId: number | null
}

/** A customer: a name and an id, nothing else (ADR-0035 §1). */
export interface CustomerRow {
  readonly id: number
  readonly name: string
  readonly createdAt: number
}

/** A preset as the picker lists it — no settings blob, because a list does not need one. */
export interface ConfigurationSummary {
  readonly id: number
  readonly name: string
  readonly updatedAt: number
  /** Whose preset; null is house (ADR-0035 §2). */
  readonly customerId: number | null
}

export interface ConfigurationRow {
  readonly id: number
  readonly name: string
  /** The settings snapshot, already parsed — the renderer's `PackingSettings`. */
  readonly settings: unknown
  readonly createdAt: number
  readonly updatedAt: number
  readonly customerId: number | null
}

export interface EstimateInput {
  readonly fileName: string
  /** Content hash of the imported model, so history survives a rename. */
  readonly contentHash: string
  readonly settings: unknown
  readonly result: unknown
  /** The active customer at save time; null (or omitted) is house (ADR-0035 §2). */
  readonly customerId?: number | null
}

export interface EstimateRow extends EstimateInput {
  readonly id: number
  readonly createdAt: number
  /** Set once at save, never changed. */
  readonly customerId: number | null
}

/**
 * The one-line offer made on load (ADR-0034 §3): the file just loaded has a
 * hash nobody has seen, and an earlier document holds receipts under the same
 * name. The person answers Link or Keep separate; nothing merges by itself.
 */
export interface LinkOffer {
  /** The hash just loaded — the one that would become a version. */
  readonly contentHash: string
  /** The earlier document's root hash. */
  readonly documentHash: string
  readonly fileName: string
  /** Receipts the earlier document holds, across all its versions. */
  readonly count: number
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
  listConfigurations(customer?: CustomerScope): Promise<ConfigurationSummary[]>
  getConfiguration(name: string): Promise<ConfigurationRow | null>
  saveConfiguration(name: string, settings: unknown, customerId?: number | null): Promise<void>
  removeConfiguration(name: string): Promise<boolean>
  /** Re-tag a preset (ADR-0035 §2). Receipts have no such call: their tag is immutable. */
  setConfigurationCustomer(name: string, customerId: number | null): Promise<boolean>
  listCustomers(): Promise<CustomerRow[]>
  /** The person's act (ADR-0035 §4): never reached by an assistant. */
  createCustomer(name: string): Promise<CustomerRow>
  recordEstimate(entry: EstimateInput): Promise<number>
  recentEstimates(limit?: number, customer?: CustomerScope): Promise<EstimateRow[]>
  /** Discard one receipt (ADR-0034 §4). Not undoable; not on the MCP wire. */
  removeEstimate(id: number): Promise<boolean>
  estimatesForContent(
    contentHash: string,
    limit?: number,
    customer?: CustomerScope
  ): Promise<EstimateRow[]>
  /** The hash's whole document — every linked version (ADR-0034 §3). */
  estimatesForDocument(
    contentHash: string,
    limit?: number,
    customer?: CustomerScope
  ): Promise<EstimateRow[]>
  linkOffer(contentHash: string, fileName: string): Promise<LinkOffer | null>
  linkDocumentVersion(contentHash: string, documentHash: string): Promise<void>
}
