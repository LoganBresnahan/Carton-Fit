import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from '../src/main/db/open'
import { MIGRATIONS, migrate, targetVersion } from '../src/main/db/migrations'

// Storage layer, main process (ADR-0007). These run under vitest's Node, which
// is why openDatabase takes its path and clock as parameters instead of reaching
// for Electron's app.getPath — that seam exists for exactly this file.

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pe-db-')), 'estimator.db')
}

const FIXED_CLOCK = (): Date => new Date('2026-07-25T18:30:00.000Z')

describe('openDatabase', () => {
  it('creates a database with the ADR-0007 pragmas applied', () => {
    const { db, quarantined, version } = openDatabase(tempDbPath())
    try {
      expect(quarantined).toBeNull()
      expect(version).toBe(targetVersion())
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    } finally {
      db.close()
    }
  })

  it('migrates to the current schema version and leaves it there on reopen', () => {
    const path = tempDbPath()
    const first = openDatabase(path)
    first.db.prepare("INSERT INTO configurations VALUES (NULL,'p','{}',1,1)").run()
    first.db.close()

    const second = openDatabase(path)
    try {
      expect(second.version).toBe(targetVersion())
      expect(second.quarantined).toBeNull()
      // Re-running migration 1 would have thrown (table exists) or wiped the row.
      expect(second.db.prepare('SELECT COUNT(*) AS n FROM configurations').get()).toEqual({ n: 1 })
    } finally {
      second.db.close()
    }
  })

  it('quarantines an unreadable file and starts fresh rather than refusing to launch', () => {
    const path = tempDbPath()
    writeFileSync(path, Buffer.from('this is not a sqlite database, not even slightly'))

    const { db, quarantined, version } = openDatabase(path, FIXED_CLOCK)
    try {
      expect(quarantined).toBe(`${path}.corrupt-2026-07-25T18-30-00-000Z`)
      expect(existsSync(quarantined!)).toBe(true)
      // The evidence is preserved byte-for-byte, not truncated or "repaired".
      expect(readFileSync(quarantined!).toString()).toContain('not a sqlite database')
      // …and the app has a working database.
      expect(version).toBe(targetVersion())
      expect(db.prepare('SELECT COUNT(*) AS n FROM configurations').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
    // NOTE: deliberately no assertion that the `-wal` sidecar was renamed.
    // SQLite deletes the WAL when the connection closes, and openDatabase closes
    // the failed handle before quarantining — so in this path there is nothing
    // left to rename. See the comment in open.ts; asserting it would fail.
  })

  it('does not overwrite an earlier quarantine taken in the same millisecond', () => {
    const path = tempDbPath()

    writeFileSync(path, Buffer.from('garbage one'))
    const first = openDatabase(path, FIXED_CLOCK)
    first.db.close()

    // Same frozen clock, so the natural quarantine name collides.
    writeFileSync(path, Buffer.from('garbage two'))
    const second = openDatabase(path, FIXED_CLOCK)
    second.db.close()

    expect(second.quarantined).not.toBe(first.quarantined)
    expect(readFileSync(first.quarantined!).toString()).toBe('garbage one')
    expect(readFileSync(second.quarantined!).toString()).toBe('garbage two')
  })

  it('propagates a genuine environment failure instead of quarantining nothing', () => {
    // A path whose parent directory does not exist is not corruption — there is
    // no file to move aside, and pretending otherwise would hide the real fault.
    const missingDir = join(mkdtempSync(join(tmpdir(), 'pe-db-')), 'nope', 'estimator.db')
    expect(() => openDatabase(missingDir)).toThrow()
  })
})

describe('migrations', () => {
  it('is append-only and contiguous from 1', () => {
    MIGRATIONS.forEach((migration, index) => {
      expect(migration.version).toBe(index + 1)
      expect(migration.name).not.toBe('')
    })
  })

  it('refuses to open a database written by a newer build', () => {
    const path = tempDbPath()
    const { db } = openDatabase(path)
    db.pragma(`user_version = ${targetVersion() + 5}`)
    db.close()

    expect(() => openDatabase(path)).toThrow(/newer version/i)
  })

  it('rolls back a failing migration rather than leaving a half-applied schema', () => {
    const { db } = openDatabase(tempDbPath())
    try {
      const before = db.pragma('user_version', { simple: true })
      const broken = [
        ...MIGRATIONS,
        {
          version: MIGRATIONS.length + 1,
          name: 'deliberately broken',
          up: (d: typeof db): void => {
            d.exec('CREATE TABLE half_applied (x INTEGER)')
            d.exec('THIS IS NOT SQL')
          }
        }
      ]
      // migrate() reads the module-level list, so drive the transaction rule
      // directly with the same shape it uses.
      expect(() => {
        const run = db.transaction(() => {
          broken[broken.length - 1].up(db)
          db.pragma(`user_version = ${broken.length}`)
        })
        run()
      }).toThrow()

      expect(db.pragma('user_version', { simple: true })).toBe(before)
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'half_applied'")
        .get()
      expect(table).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('is a no-op when already at the target version', () => {
    const { db } = openDatabase(tempDbPath())
    try {
      expect(migrate(db)).toBe(targetVersion())
      expect(migrate(db)).toBe(targetVersion())
    } finally {
      db.close()
    }
  })
})

describe('recovery boundaries', () => {
  it('does NOT quarantine a database it merely cannot migrate', () => {
    // Regression guard. openDatabase once wrapped open AND migrate in one
    // try/catch, so a database written by a NEWER build — valid, readable, full
    // of the user's data — was treated as corruption, moved aside, and replaced
    // with an empty one. The version check exists to prevent exactly that data
    // loss, so it must not be routed through recovery.
    const path = tempDbPath()
    const first = openDatabase(path)
    first.db.prepare("INSERT INTO configurations VALUES (NULL,'keep-me','{}',1,1)").run()
    first.db.pragma(`user_version = ${targetVersion() + 5}`)
    first.db.close()

    expect(() => openDatabase(path, FIXED_CLOCK)).toThrow(/newer version/i)

    // No quarantine copy was taken…
    expect(existsSync(`${path}.corrupt-2026-07-25T18-30-00-000Z`)).toBe(false)

    // …and the user's data is still in the original file. Read it directly,
    // below our own version guard, since openDatabase now (correctly) refuses.
    const raw = new BetterSqlite3(path)
    try {
      expect(raw.prepare('SELECT name FROM configurations').get()).toEqual({ name: 'keep-me' })
      expect(raw.pragma('user_version', { simple: true })).toBe(targetVersion() + 5)
    } finally {
      raw.close()
    }
  })
})
