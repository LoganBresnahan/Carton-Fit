import type { Database, Statement } from 'better-sqlite3'
import type { CustomerRow } from '../../shared/storage'

// Customers (ADR-0035): a name and an id, a label on presets and receipts,
// never an input. Creating one is the person's act — no tool does it — and
// there is no delete in this version (revisit trigger: receipts that want to
// move between customers).

interface StoredRow {
  id: number
  name: string
  created_at: number
}

export class CustomersStore {
  readonly #insert: Statement
  readonly #list: Statement
  readonly #byId: Statement
  readonly #now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.#now = now
    this.#insert = db.prepare('INSERT INTO customers (name, created_at) VALUES (@name, @now)')
    // Alphabetical, like presets: a selector is scanned by eye.
    this.#list = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE ASC')
    this.#byId = db.prepare('SELECT * FROM customers WHERE id = ?')
  }

  /**
   * Create a customer. The name is trimmed, must be non-empty, and must be
   * new — UNIQUE on the column is what makes "Acme" and a second "Acme" one
   * customer rather than two that look alike.
   */
  create(name: string): CustomerRow {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('a customer needs a name')
    const info = this.#insert.run({ name: trimmed, now: this.#now() })
    return this.byId(Number(info.lastInsertRowid)) as CustomerRow
  }

  list(): CustomerRow[] {
    return (this.#list.all() as StoredRow[]).map(hydrate)
  }

  byId(id: number): CustomerRow | null {
    const row = this.#byId.get(id) as StoredRow | undefined
    return row === undefined ? null : hydrate(row)
  }
}

function hydrate(row: StoredRow): CustomerRow {
  return { id: row.id, name: row.name, createdAt: row.created_at }
}
