import type { Database, Statement } from 'better-sqlite3'
import type { EstimateInput, EstimateRow } from '../../shared/storage'

// Estimate history (ADR-0007). Append-only by design: VISION says every
// estimate is recorded, and re-running the same part against the same carton is
// a real event worth seeing twice — so there is no upsert here and no unique
// constraint to collide with.

interface StoredRow {
  id: number
  file_name: string
  content_hash: string
  settings: string
  result: string
  created_at: number
}

export class EstimatesStore {
  readonly #insert: Statement
  readonly #recent: Statement
  readonly #byHash: Statement
  readonly #byDocument: Statement
  readonly #byId: Statement
  readonly #remove: Statement
  readonly #now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.#now = now
    this.#insert = db.prepare(`
      INSERT INTO estimates (file_name, content_hash, settings, result, created_at)
      VALUES (@fileName, @contentHash, @settings, @result, @createdAt)
    `)
    // NEWEST FIRST MEANS INSERTION ORDER, and `id` is the insertion order.
    // This used to be `created_at DESC, id DESC` — the clock first, the id as
    // a tiebreak for two rows in one millisecond. The tiebreak was the honest
    // key all along: `created_at` is a reading of the wall clock at write time
    // and the wall clock is not monotonic (2026-09-08: a WSL2 machine on the
    // `tsc` clocksource stamped one save 110 s ahead of the saves either side
    // of it, and the newest receipt listed third). `created_at` stays what it
    // is — the time shown on the row — but it no longer decides the order.
    this.#recent = db.prepare('SELECT * FROM estimates ORDER BY id DESC LIMIT ?')
    this.#byHash = db.prepare('SELECT * FROM estimates WHERE content_hash = ? ORDER BY id DESC LIMIT ?')
    // The document's whole set (ADR-0034 §3): the hash's root, plus every hash
    // linked to that root. A hash with no alias row is its own root, so this
    // reduces to `forContent` for an unlinked part.
    this.#byDocument = db.prepare(`
      WITH root AS (
        SELECT COALESCE(
          (SELECT document_hash FROM document_versions WHERE content_hash = @hash), @hash
        ) AS hash
      )
      SELECT * FROM estimates
      WHERE content_hash = (SELECT hash FROM root)
         OR content_hash IN (
           SELECT content_hash FROM document_versions
           WHERE document_hash = (SELECT hash FROM root)
         )
      ORDER BY id DESC LIMIT @limit
    `)
    this.#byId = db.prepare('SELECT * FROM estimates WHERE id = ?')
    this.#remove = db.prepare('DELETE FROM estimates WHERE id = ?')
  }

  /** Record an estimate. Returns its new id. */
  record(entry: EstimateInput): number {
    const info = this.#insert.run({
      fileName: entry.fileName,
      contentHash: entry.contentHash,
      settings: JSON.stringify(entry.settings),
      result: JSON.stringify(entry.result),
      createdAt: this.#now()
    })
    return Number(info.lastInsertRowid)
  }

  /** Most recent estimates, newest first. */
  recent(limit = 50): EstimateRow[] {
    return (this.#recent.all(limit) as StoredRow[]).map(hydrate)
  }

  /** One row by id, or null. Added for the MCP restore tool (ADR-0029 v3),
   *  which is handed an id from a list rather than a row: the app's own restore
   *  button already holds the row it is rendering, so this is the first caller
   *  that has to look one up. */
  byId(id: number): EstimateRow | null {
    const row = this.#byId.get(id) as StoredRow | undefined
    return row === undefined ? null : hydrate(row)
  }

  /** History for one exact hash, newest first — "have I estimated this before?". */
  forContent(contentHash: string, limit = 50): EstimateRow[] {
    return (this.#byHash.all(contentHash, limit) as StoredRow[]).map(hydrate)
  }

  /**
   * History for a hash's whole DOCUMENT — every version linked to it —
   * newest first (ADR-0034 §3). What the scoped list shows. An empty hash
   * matches nothing: rows saved with `''` are never anyone's document.
   */
  forDocument(contentHash: string, limit = 50): EstimateRow[] {
    if (contentHash === '') return []
    return (this.#byDocument.all({ hash: contentHash, limit }) as StoredRow[]).map(hydrate)
  }

  /**
   * Discard one receipt (ADR-0034 §4). The person's act, from the panel only:
   * the MCP surface stays append-only for estimates, because everything else
   * it does is undoable and this is not. Returns whether a row went, so a
   * caller can tell "gone" from "never existed".
   */
  remove(id: number): boolean {
    return this.#remove.run(id).changes > 0
  }
}

function hydrate(row: StoredRow): EstimateRow {
  return {
    id: row.id,
    fileName: row.file_name,
    contentHash: row.content_hash,
    settings: JSON.parse(row.settings),
    result: JSON.parse(row.result),
    createdAt: row.created_at
  }
}
