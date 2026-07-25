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
 * Every migration, in order. v1 arrives with the `v1-schema` slice.
 */
export const MIGRATIONS: readonly Migration[] = []

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
        `${target}. It was written by a newer version of Packaging Estimator; ` +
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
