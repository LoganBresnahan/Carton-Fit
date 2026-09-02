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
  readonly #byId: Statement
  readonly #now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.#now = now
    this.#insert = db.prepare(`
      INSERT INTO estimates (file_name, content_hash, settings, result, created_at)
      VALUES (@fileName, @contentHash, @settings, @result, @createdAt)
    `)
    // `id DESC` is not decoration: created_at is epoch MILLISECONDS, and two
    // estimates recorded in the same millisecond are entirely possible when the
    // renderer records a batch. Without the tiebreak their order would be
    // whatever SQLite happened to choose, and "most recent" would flicker
    // between reads.
    this.#recent = db.prepare('SELECT * FROM estimates ORDER BY created_at DESC, id DESC LIMIT ?')
    this.#byHash = db.prepare(
      'SELECT * FROM estimates WHERE content_hash = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    this.#byId = db.prepare('SELECT * FROM estimates WHERE id = ?')
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

  /** History for one part, newest first — "have I estimated this before?". */
  forContent(contentHash: string, limit = 50): EstimateRow[] {
    return (this.#byHash.all(contentHash, limit) as StoredRow[]).map(hydrate)
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
