import type { Database, Statement } from 'better-sqlite3'
import type { ConfigurationRow, ConfigurationSummary, CustomerScope } from '../../shared/storage'
import { customerParams } from './customerScope'

// Named presets (ADR-0007). Direct better-sqlite3 API, no wrapper layer — the
// ADR is explicit that there are no legacy call sites to preserve, so an
// abstraction here would be one we invented for ourselves to maintain.

interface StoredRow {
  id: number
  name: string
  settings: string
  created_at: number
  updated_at: number
  customer_id: number | null
}

export class ConfigurationsStore {
  readonly #upsert: Statement
  readonly #byName: Statement
  readonly #list: Statement
  readonly #count: Statement
  readonly #remove: Statement
  readonly #setCustomer: Statement
  readonly #now: () => number

  /**
   * @param now injectable clock (epoch ms) so tests can assert timestamps
   * rather than merely that they exist.
   */
  constructor(db: Database, now: () => number = Date.now) {
    this.#now = now

    // Save is an upsert keyed on the UNIQUE name: "save preset X" must mean the
    // same thing whether or not X exists, and doing it in one statement avoids
    // a check-then-write race. created_at is deliberately NOT touched on
    // update — a preset keeps its original creation time.
    // The customer travels with the save (ADR-0035 §2): re-saving a name
    // under another customer moves the preset, since a preset is a library
    // entry, not a record of a decision.
    this.#upsert = db.prepare(`
      INSERT INTO configurations (name, settings, created_at, updated_at, customer_id)
      VALUES (@name, @settings, @now, @now, @customerId)
      ON CONFLICT(name) DO UPDATE SET
        settings    = excluded.settings,
        updated_at  = excluded.updated_at,
        customer_id = excluded.customer_id
    `)
    this.#byName = db.prepare('SELECT * FROM configurations WHERE name = ?')
    // Alphabetical: a preset picker is scanned by eye, not by recency. The
    // customer filter is house-plus-active (ADR-0035 §3) or everything.
    this.#list = db.prepare(`
      SELECT id, name, updated_at, customer_id FROM configurations
      WHERE (@all = 1 OR customer_id IS NULL OR customer_id = @customer)
      ORDER BY name ASC
    `)
    this.#count = db.prepare(`
      SELECT COUNT(*) AS n FROM configurations
      WHERE (@all = 1 OR customer_id IS NULL OR customer_id = @customer)
    `)
    this.#remove = db.prepare('DELETE FROM configurations WHERE name = ?')
    this.#setCustomer = db.prepare('UPDATE configurations SET customer_id = ? WHERE name = ?')
  }

  /** Create or overwrite the preset called `name`, tagged for `customerId` (null = house). */
  save(name: string, settings: unknown, customerId: number | null = null): void {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('a configuration needs a name')
    this.#upsert.run({
      name: trimmed,
      settings: JSON.stringify(settings),
      now: this.#now(),
      customerId
    })
  }

  /** Re-tag a preset (ADR-0035 §2: a preset's customer may change; a receipt's never does). */
  setCustomer(name: string, customerId: number | null): boolean {
    return this.#setCustomer.run(customerId, name).changes > 0
  }

  /** The named preset, or null. */
  get(name: string): ConfigurationRow | null {
    const row = this.#byName.get(name) as StoredRow | undefined
    return row ? hydrate(row) : null
  }

  /** Presets, alphabetical — house plus the active customer's, or all of them. */
  list(customer?: CustomerScope): ConfigurationSummary[] {
    type Summary = Pick<StoredRow, 'id' | 'name' | 'updated_at' | 'customer_id'>
    return (this.#list.all(customerParams(customer)) as Summary[]).map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      customerId: row.customer_id
    }))
  }

  /** How many rows `list` would return — under the filter, or all (ADR-0035 amendment 1). */
  count(customer?: CustomerScope): number {
    return (this.#count.get(customerParams(customer)) as { n: number }).n
  }

  /** Returns whether a preset was actually removed, so callers can tell "gone" from "never existed". */
  remove(name: string): boolean {
    return this.#remove.run(name).changes > 0
  }
}

function hydrate(row: StoredRow): ConfigurationRow {
  return {
    id: row.id,
    name: row.name,
    // A settings blob that will not parse means the row is unusable; failing
    // here is better than handing the renderer `undefined` and letting it
    // render a half-loaded preset.
    settings: JSON.parse(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerId: row.customer_id
  }
}
