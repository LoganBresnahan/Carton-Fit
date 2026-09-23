import type { Database, Statement } from 'better-sqlite3'
import type { CustomerRow, CustomerUsage } from '../../shared/storage'

// Customers (ADR-0035): a name and an id, a label on presets and receipts,
// never an input. Creating, renaming and deleting one are the person's acts —
// no tool does any of them. Delete MOVES what the customer tagged (amendment
// 2): `customer_id` is not a foreign key, so this class is where the
// invariant "no row names a customer that does not exist" is kept.

interface StoredRow {
  id: number
  name: string
  created_at: number
}

export class CustomersStore {
  readonly #db: Database
  readonly #insert: Statement
  readonly #list: Statement
  readonly #byId: Statement
  readonly #sameName: Statement
  readonly #rename: Statement
  readonly #presetsOf: Statement
  readonly #estimatesOf: Statement
  readonly #movePresets: Statement
  readonly #moveEstimates: Statement
  readonly #delete: Statement
  readonly #now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.#db = db
    this.#now = now
    this.#insert = db.prepare('INSERT INTO customers (name, created_at) VALUES (@name, @now)')
    // Alphabetical, like presets: a selector is scanned by eye.
    this.#list = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE ASC')
    this.#byId = db.prepare('SELECT * FROM customers WHERE id = ?')
    // Case-insensitive, and blind to the row being renamed: "Acme" beside
    // "ACME" is the duplicate amendment 2 exists to fix, while changing only
    // the case of a customer's own name is a rename like any other.
    this.#sameName = db.prepare(
      'SELECT id FROM customers WHERE name = @name COLLATE NOCASE AND id != @except'
    )
    this.#rename = db.prepare('UPDATE customers SET name = @name WHERE id = @id')
    this.#presetsOf = db.prepare('SELECT COUNT(*) AS n FROM configurations WHERE customer_id = ?')
    this.#estimatesOf = db.prepare('SELECT COUNT(*) AS n FROM estimates WHERE customer_id = ?')
    this.#movePresets = db.prepare(
      'UPDATE configurations SET customer_id = @to WHERE customer_id = @from'
    )
    this.#moveEstimates = db.prepare(
      'UPDATE estimates SET customer_id = @to WHERE customer_id = @from'
    )
    this.#delete = db.prepare('DELETE FROM customers WHERE id = ?')
  }

  /** A trimmed, non-empty name no OTHER customer holds, in any case — or a
   *  sentence worth showing in the storage banner. */
  #validName(name: string, except: number): string {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('a customer needs a name')
    if (this.#sameName.get({ name: trimmed, except }) !== undefined) {
      throw new Error(`a customer named “${trimmed}” already exists`)
    }
    return trimmed
  }

  /**
   * Create a customer. The name is trimmed, must be non-empty, and must be
   * new in any case — "Acme" and "ACME" are one customer, not two that look
   * alike in a selector.
   */
  create(name: string): CustomerRow {
    const valid = this.#validName(name, -1)
    const info = this.#insert.run({ name: valid, now: this.#now() })
    return this.byId(Number(info.lastInsertRowid)) as CustomerRow
  }

  /** Rename (amendment 2). Rows carry the id, so nothing else changes. */
  rename(id: number, name: string): CustomerRow {
    if (this.byId(id) === null) throw new Error('no such customer')
    this.#rename.run({ id, name: this.#validName(name, id) })
    return this.byId(id) as CustomerRow
  }

  /** How many presets and receipts carry this customer. */
  usage(id: number): CustomerUsage {
    return {
      presets: (this.#presetsOf.get(id) as { n: number }).n,
      estimates: (this.#estimatesOf.get(id) as { n: number }).n
    }
  }

  /**
   * Delete a customer by moving everything it tagged to `moveTo` (null is
   * house), in one transaction — so no row is ever left naming a customer
   * that does not exist, and nothing is destroyed (amendment 2).
   *
   * @returns what moved, which is what the dialog promised.
   */
  remove(id: number, moveTo: number | null): CustomerUsage {
    if (this.byId(id) === null) throw new Error('no such customer')
    if (moveTo === id) throw new Error('a customer’s rows cannot move to the customer being deleted')
    if (moveTo !== null && this.byId(moveTo) === null) {
      throw new Error('the customer to move the rows to does not exist')
    }
    return this.#db.transaction(() => {
      const moved = this.usage(id)
      this.#movePresets.run({ from: id, to: moveTo })
      this.#moveEstimates.run({ from: id, to: moveTo })
      this.#delete.run(id)
      return moved
    })()
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
