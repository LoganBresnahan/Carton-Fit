import type { Database } from 'better-sqlite3'

// Schema versioning via `PRAGMA user_version` (ADR-0007), ported from the
// reference app's pattern. This file is the single source of truth for schema
// shape: no ad-hoc DDL anywhere else, ever.
//
// Rules that keep this safe:
//   - Migrations are append-only. Never edit a shipped migration — a user's DB
//     already ran it, and editing changes what NEW databases get while leaving
//     old ones untouched. Add another migration instead.
//   - `version` is the schema version the migration PRODUCES, and the list must
//     be contiguous from 1. `migrate` asserts that rather than trusting it.
//   - Each migration runs in ONE transaction together with its version bump, so
//     a crash mid-migration leaves the DB at the previous version rather than
//     half-upgraded.

export interface Migration {
  /** Schema version this migration produces. */
  readonly version: number
  /** Human-readable summary, surfaced in errors. */
  readonly name: string
  readonly up: (db: Database) => void
}

/**
 * Every migration, in order.
 *
 * Design note that applies to both tables: **settings and results are stored as
 * JSON text, not exploded into columns.** `PackingSettings` has twelve fields
 * today and will grow (ADR-0004's revisit triggers already name box tare weight
 * and a density library); a column per field would mean a migration per product
 * tweak. The main process never queries *inside* these blobs — it reads a row
 * and hands it to the renderer — so there is nothing to gain from columns and a
 * schema churn to lose. Anything genuinely queryable gets its own column
 * (`name`, `file_name`, `content_hash`, `created_at`).
 *
 * Timestamps are INTEGER epoch milliseconds: unambiguous about timezone, sorts
 * numerically, and matches `Date.now()` at both call sites. Canonical units are
 * mm/g inside the settings blob per ADR-0004 — this layer stores, it does not
 * convert.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'configurations + estimates',
    up: (db) => {
      // Named presets. UNIQUE(name) is what makes "save" an upsert and gives
      // rename a real constraint rather than a check-then-write race.
      db.exec(`
        CREATE TABLE configurations (
          id         INTEGER PRIMARY KEY,
          name       TEXT    NOT NULL UNIQUE,
          settings   TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT
      `)

      // Estimate history. Deliberately append-only and NOT unique on
      // (content_hash, settings): re-running the same part against the same
      // carton is a real event worth seeing twice in history, and VISION says
      // every estimate is recorded.
      db.exec(`
        CREATE TABLE estimates (
          id           INTEGER PRIMARY KEY,
          file_name    TEXT    NOT NULL,
          content_hash TEXT    NOT NULL,
          settings     TEXT    NOT NULL,
          result       TEXT    NOT NULL,
          created_at   INTEGER NOT NULL
        ) STRICT
      `)

      // History is read newest-first, and "have I estimated this part before?"
      // is the other question the UI will ask.
      db.exec('CREATE INDEX estimates_created_at ON estimates(created_at DESC)')
      db.exec('CREATE INDEX estimates_content_hash ON estimates(content_hash)')
    }
  },
  {
    version: 2,
    name: 'document_versions',
    up: (db) => {
      // A document is a SET of content hashes (ADR-0034 §3): re-export a part
      // from CAD and its hash moves, and rev B is the normal case in a shop,
      // not the edge case. This table maps a later hash to the document's
      // first one. It is an ALIAS table, not a column on `estimates`: every
      // receipt keeps the hash it was saved against, the list can label one
      // from an earlier version, and dropping this table would leave every
      // receipt exactly as saved. A hash with no row here is its own document.
      //
      // One row per content hash — a version belongs to one document — and
      // `document_hash` is always a root (never itself an alias); the store
      // resolves through before writing, so lookups are one hop.
      db.exec(`
        CREATE TABLE document_versions (
          content_hash  TEXT    PRIMARY KEY,
          document_hash TEXT    NOT NULL,
          linked_at     INTEGER NOT NULL
        ) STRICT
      `)
      db.exec('CREATE INDEX document_versions_document ON document_versions(document_hash)')
    }
  },
  {
    version: 3,
    name: 'customers',
    up: (db) => {
      // A customer is a name and an id (ADR-0035 §1). Nothing else, on
      // purpose: an address or a contact is a CRM, and every such field is a
      // request to be refused on its own.
      db.exec(`
        CREATE TABLE customers (
          id         INTEGER PRIMARY KEY,
          name       TEXT    NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        ) STRICT
      `)
      // A preset and a receipt each carry an optional customer (§2). NULL is
      // HOUSE — the carton everyone gets — and is the common case, so every
      // existing row is a house row by definition and needs no backfill. Not
      // a foreign key: a customer is never deleted in this version, and a
      // constraint that cannot fire is a promise the schema cannot keep.
      db.exec('ALTER TABLE configurations ADD COLUMN customer_id INTEGER')
      db.exec('ALTER TABLE estimates ADD COLUMN customer_id INTEGER')
    }
  }
]

/** The schema version this build expects once fully migrated. */
export function targetVersion(): number {
  return MIGRATIONS.length === 0 ? 0 : MIGRATIONS[MIGRATIONS.length - 1].version
}

function currentVersion(db: Database): number {
  // better-sqlite3's pragma() returns a scalar with { simple: true }.
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * Bring `db` up to `targetVersion()`, running only the migrations it still
 * needs. Idempotent: calling it on an up-to-date database does nothing.
 *
 * Returns the version the database is at afterwards.
 *
 * @throws if the database is NEWER than this build understands — that means an
 * older app opening a database a newer app already upgraded, and silently
 * proceeding could corrupt data the old code cannot represent. Failing loudly
 * is the only honest option.
 */
export function migrate(db: Database): number {
  assertContiguous()

  const target = targetVersion()
  const from = currentVersion(db)

  if (from > target) {
    throw new Error(
      `database schema is version ${from}, but this build only understands ` +
        `${target}. It was written by a newer version of Carton Fit; ` +
        `upgrade the app rather than downgrading the data.`
    )
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue

    // DDL and the version bump share one transaction. better-sqlite3's
    // transaction() rolls back automatically if the function throws.
    const run = db.transaction(() => {
      migration.up(db)
      // PRAGMA cannot be parameterized, so the value is interpolated — safe
      // only because assertContiguous() has proven these are integers we
      // generated, never user input.
      db.pragma(`user_version = ${migration.version}`)
    })

    try {
      run()
    } catch (cause) {
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed; database ` +
          `left at version ${currentVersion(db)}`,
        { cause }
      )
    }
  }

  return currentVersion(db)
}

/**
 * Guard the assumptions the rest of this file relies on: versions are integers
 * starting at 1, strictly ascending by one, with no duplicates. A mistake here
 * would otherwise show up as a migration silently never running.
 */
function assertContiguous(): void {
  MIGRATIONS.forEach((migration, index) => {
    const expected = index + 1
    if (!Number.isInteger(migration.version) || migration.version !== expected) {
      throw new Error(
        `MIGRATIONS is not contiguous: entry ${index} declares version ` +
          `${migration.version}, expected ${expected}. Migrations are ` +
          `append-only and numbered from 1.`
      )
    }
  })
}
