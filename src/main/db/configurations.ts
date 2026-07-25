import type { Database, Statement } from 'better-sqlite3'
import type { ConfigurationRow, ConfigurationSummary } from '../../shared/storage'

// Named presets (ADR-0007). Direct better-sqlite3 API, no wrapper layer — the
// ADR is explicit that there are no legacy call sites to preserve, so an
// abstraction here would be one we invented for ourselves to maintain.

interface StoredRow {
  id: number
  name: string
  settings: string
  created_at: number
  updated_at: number
}

export class ConfigurationsStore {
  readonly #upsert: Statement
  readonly #byName: Statement
  readonly #list: Statement
  readonly #remove: Statement
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
    this.#upsert = db.prepare(`
      INSERT INTO configurations (name, settings, created_at, updated_at)
      VALUES (@name, @settings, @now, @now)
      ON CONFLICT(name) DO UPDATE SET
        settings   = excluded.settings,
        updated_at = excluded.updated_at
    `)
    this.#byName = db.prepare('SELECT * FROM configurations WHERE name = ?')
    // Alphabetical: a preset picker is scanned by eye, not by recency.
    this.#list = db.prepare('SELECT id, name, updated_at FROM configurations ORDER BY name ASC')
    this.#remove = db.prepare('DELETE FROM configurations WHERE name = ?')
  }

  /** Create or overwrite the preset called `name`. */
  save(name: string, settings: unknown): void {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('a configuration needs a name')
    this.#upsert.run({ name: trimmed, settings: JSON.stringify(settings), now: this.#now() })
  }

  /** The named preset, or null. */
  get(name: string): ConfigurationRow | null {
    const row = this.#byName.get(name) as StoredRow | undefined
    return row ? hydrate(row) : null
  }

  list(): ConfigurationSummary[] {
    return (this.#list.all() as Pick<StoredRow, 'id' | 'name' | 'updated_at'>[]).map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at
    }))
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
    updatedAt: row.updated_at
  }
}
