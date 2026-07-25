import BetterSqlite3, { type Database } from 'better-sqlite3'
import { existsSync, renameSync } from 'node:fs'
import { migrate } from './migrations'

// Open-with-recovery (ADR-0007): a corrupt database file must never stop the
// app from starting. Packing estimates are re-derivable and presets are cheap
// to re-enter; refusing to launch would be a worse outcome than losing them.
//
// The path is a PARAMETER, not `app.getPath('userData')` read in here. That
// keeps this module free of Electron so vitest can drive it against temp dirs
// (the caller in main/ supplies the real path). Losing that seam would make the
// db tests need a running Electron.

export interface OpenedDatabase {
  readonly db: Database
  /**
   * Where the unreadable file was moved, if recovery happened. `null` on a
   * normal open — callers should surface a non-null value to the user, since
   * it means their saved data is gone from the app's point of view.
   */
  readonly quarantined: string | null
  /** Schema version after migration. */
  readonly version: number
}

/**
 * Open (or create) the database at `dbPath`, applying the ADR-0007 pragmas and
 * running migrations. If the file exists but is unreadable, quarantine it and
 * start fresh.
 *
 * @param now injectable clock for the quarantine suffix — tests need it
 * deterministic, and `core/` conventions forbid hidden non-determinism.
 */
export function openDatabase(dbPath: string, now: () => Date = () => new Date()): OpenedDatabase {
  try {
    return { ...prepare(dbPath), quarantined: null }
  } catch (firstError) {
    // A file that does not exist is not a corruption case — better-sqlite3
    // would have created it. If we failed anyway, the problem is the directory
    // or permissions, and quarantining nothing would just hide that.
    if (!existsSync(dbPath)) throw firstError

    const quarantined = quarantine(dbPath, now())
    // Second failure is not recoverable by the same trick: the file we just
    // created is fresh, so the fault is environmental. Let it out.
    return { ...prepare(dbPath), quarantined }
  }
}

/** Open, configure, and migrate — the whole happy path, so both attempts share it. */
function prepare(dbPath: string): { db: Database; version: number } {
  const db = new BetterSqlite3(dbPath)
  try {
    // WAL survives a crash mid-write and lets reads proceed during writes.
    db.pragma('journal_mode = WAL')
    // Never block forever behind another connection.
    db.pragma('busy_timeout = 5000')
    // Off by default in SQLite; the schema relies on it.
    db.pragma('foreign_keys = ON')

    // FORCE the header to be parsed. better-sqlite3 opens lazily, so a corrupt
    // file constructs a Database object without complaint and only throws on
    // first real access. Without this read, corruption would surface later —
    // somewhere with no recovery path — instead of here.
    db.pragma('user_version', { simple: true })

    const version = migrate(db)
    return { db, version }
  } catch (error) {
    // Do not leak the handle on the failure path; the quarantine rename below
    // needs the file closed on Windows, where an open handle blocks it.
    try {
      db.close()
    } catch {
      /* already unusable — the original error is the one that matters */
    }
    throw error
  }
}

/**
 * Move an unreadable database aside, WAL sidecars included.
 *
 * Sidecars matter in principle: leaving `-wal`/`-shm` next to a fresh database
 * would let SQLite replay a journal belonging to the file we just rejected.
 *
 * MEASURED: in the ordinary corruption path they are usually already gone —
 * SQLite deletes the WAL when the connection closes, and `prepare()` closes the
 * handle before we get here (verified: a stale `-wal` beside a garbage file is
 * removed by `db.close()` after `SQLITE_NOTADB`). So this loop is the
 * belt-and-braces case for when the close itself failed. **Do not write a test
 * asserting the sidecar gets renamed in the normal path — it cannot.**
 */
function quarantine(dbPath: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  let target = `${dbPath}.corrupt-${stamp}`

  // Two recoveries within the same millisecond, or a restored backup hitting
  // the same name, must not overwrite the earlier evidence.
  for (let n = 2; existsSync(target); n++) target = `${dbPath}.corrupt-${stamp}-${n}`

  renameSync(dbPath, target)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, target + suffix)
  }
  return target
}
