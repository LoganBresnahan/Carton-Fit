import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importSample, launchApp, waitForEstimate } from './harness'

/**
 * Storage trouble has to be visible (roadmap item 9).
 *
 * `storageError` used to be rendered only inside the configurations panel, which
 * sits at the bottom of a scrolling column. A user who never scrolled there was
 * never told that their saves were not saving and their history was not being
 * kept — silence read exactly like success.
 *
 * PACKAGED ONLY, like the other storage specs: better-sqlite3 is compiled for
 * whichever ABI packaged last, so in a dev run main legitimately reports storage
 * unavailable and the failure under test would be indistinguishable from the
 * environment (ADR-0013).
 */
test.describe('storage failures are visible', () => {
  test.skip(!process.env.PACKAGED_APP, 'needs the Electron-ABI build of better-sqlite3')

  const DB = 'carton-fit.db'

  /**
   * Break storage the way a real downgrade does: stamp a schema version from the
   * future. `migrate()` refuses to touch a database newer than the build — and
   * deliberately does NOT quarantine it, since that was the data-loss bug the DB
   * tests caught — so the open fails and every storage call rejects.
   *
   * Written by patching the SQLite header directly (user_version is a 4-byte
   * big-endian field at offset 60) rather than by opening the file with
   * better-sqlite3, which in this process is built for the wrong ABI.
   */
  function stampFutureSchema(dir: string): void {
    const path = join(dir, DB)
    const bytes = readFileSync(path)
    bytes.writeUInt32BE(999, 60)
    writeFileSync(path, bytes)
    // Drop the WAL so the patched header is what the next open reads.
    for (const suffix of ['-wal', '-shm']) {
      const side = `${path}${suffix}`
      if (existsSync(side)) rmSync(side)
    }
  }

  test('reports a broken database without the user scrolling to find it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-e2e-banner-'))
    const args = [`--user-data-dir=${dir}`]

    // First launch just to create the database — it opens lazily, on the
    // configurations panel's first list call.
    const first = await launchApp(args)
    try {
      await first.page.waitForSelector('[data-testid="configurations-panel"]')
      await expect(first.page.locator('[data-testid="storage-error"]')).toHaveCount(0)
    } finally {
      await first.app.close()
    }
    expect(existsSync(join(dir, DB)), 'no database to break').toBe(true)

    stampFutureSchema(dir)

    const second = await launchApp(args)
    try {
      const banner = second.page.locator('[data-testid="storage-error"]')
      await expect(banner).toBeVisible({ timeout: 10_000 })
      await expect(banner).toContainText(/newer/i)

      // The point of the slice: visible WITHOUT scrolling, and still visible
      // when the configurations panel — where this used to be the only report —
      // is scrolled out of sight.
      await second.page.locator('[data-testid="dropzone"]').scrollIntoViewIfNeeded()
      await expect(banner).toBeInViewport()

      await second.page.locator('[data-testid="configurations-panel"]').scrollIntoViewIfNeeded()
      await expect(banner).toBeInViewport()
    } finally {
      await second.app.close()
    }
  })

  test('an estimate still works while storage is broken', async () => {
    // Storage is optional by design (ADR-0007): the answer must not depend on
    // it. The banner says what is degraded; it does not stop the app working.
    const dir = mkdtempSync(join(tmpdir(), 'pe-e2e-banner2-'))
    const args = [`--user-data-dir=${dir}`]

    const first = await launchApp(args)
    try {
      await first.page.waitForSelector('[data-testid="configurations-panel"]')
    } finally {
      await first.app.close()
    }
    stampFutureSchema(dir)

    const { app, page } = await launchApp(args)
    try {
      await expect(page.locator('[data-testid="storage-error"]')).toBeVisible({ timeout: 10_000 })
      await importSample(page, 'cube-10x10.stl')
      await waitForEstimate(page)
      await expect(page.locator('[data-testid="results-headline"]')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
