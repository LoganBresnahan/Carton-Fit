import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, launchApp, type AppHandle } from './harness'

/**
 * The update check (ADR-0021).
 *
 * `tests/update-version.test.ts` pins the compare. What only a real window can
 * show is the chain around it: main fetching on launch, the compare being
 * consulted against `app.getVersion()` rather than the banner appearing
 * unconditionally, the preload surface existing, the renderer asking, and the
 * failure path staying SILENT — which is a contract, not an absence, so it gets
 * a spec of its own.
 *
 * GitHub is never contacted. `UPDATE_CHECK_URL` points main at a local fixture,
 * which is the only way to exercise both outcomes without depending on what
 * happens to be published today, and without a spec that changes meaning the
 * moment a release goes out.
 *
 * PACKAGED ONLY, for a reason worth writing down: in a dev run `app.getVersion()`
 * returns "0.0". Electron falls back to that when the main script has no
 * adjacent package.json, which is exactly the shape of `out/main/index.js`. Two
 * components do not parse, so the check correctly says nothing — and every spec
 * here would pass VACUOUSLY, the silence ones included. Only a packaged build
 * reports the real version, so only a packaged build can prove any of this.
 */
test.skip(!process.env.PACKAGED_APP, 'app.getVersion() is "0.0" until the app is packaged')

/** The version this build reports — main compares the fixture's tag to it. */
const CURRENT = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version as string

interface Fixture {
  url: string
  close: () => Promise<void>
}

/** Serve one Releases-API-shaped response on a loopback port. */
async function serveRelease(body: unknown, status = 200): Promise<Fixture> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture has no port')
  return {
    url: `http://127.0.0.1:${address.port}/releases/latest`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Launch with main pointed at `url`.
 *
 * The env var is set around the launch only: `launchApp` copies the current
 * `process.env` into the child, and leaving it set would silently reconfigure
 * every later spec in this worker.
 */
async function launchAgainst(url: string): Promise<AppHandle> {
  process.env.UPDATE_CHECK_URL = url
  try {
    return await launchApp()
  } finally {
    delete process.env.UPDATE_CHECK_URL
  }
}

test('a newer published release is announced, with a working download link', async () => {
  const fixture = await serveRelease({
    tag_name: 'v99.1.0',
    html_url: 'https://example.invalid/carton-fit/releases/99.1.0'
  })
  const handle = await launchAgainst(fixture.url)
  try {
    const banner = handle.page.locator('[data-testid="update-available"]')
    // The check is deliberately started after the window shows, so the banner
    // arrives a moment later than everything else on screen.
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('99.1.0')

    // Download must open the SYSTEM BROWSER, not navigate the app: an Electron
    // window that has browsed to github.com is no longer the app. Stubbed
    // because it launches a real browser otherwise.
    await handle.app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as Record<string, unknown>).openedUrls = opened
      shell.openExternal = (async (target: string) => {
        opened.push(target)
      }) as never
    })
    await handle.page.click('[data-testid="update-download"]')

    await expect
      .poll(
        async () =>
          handle.app.evaluate(
            () => ((globalThis as Record<string, unknown>).openedUrls as string[]) ?? []
          ),
        { timeout: 5_000 }
      )
      .toEqual(['https://example.invalid/carton-fit/releases/99.1.0'])

    // The renderer's window never left the app.
    await expect(handle.page.locator('[data-testid="dropzone"]')).toBeVisible()
  } finally {
    await handle.app.close()
    await fixture.close()
  }
})

test('the banner can be dismissed for this session', async () => {
  const fixture = await serveRelease({ tag_name: 'v99.1.0', html_url: 'https://example.invalid/r' })
  const handle = await launchAgainst(fixture.url)
  try {
    const banner = handle.page.locator('[data-testid="update-available"]')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await handle.page.click('[data-testid="update-dismiss"]')
    await expect(banner).toHaveCount(0)
  } finally {
    await handle.app.close()
    await fixture.close()
  }
})

test('the current version is not announced as an update', async () => {
  // The endpoint answers on every launch of an up-to-date app, which is the
  // ordinary case. Without this, a banner that ignored the compare entirely
  // would still pass the spec above.
  const fixture = await serveRelease({ tag_name: `v${CURRENT}`, html_url: 'https://example.invalid/r' })
  const handle = await launchAgainst(fixture.url)
  try {
    await handle.page.waitForTimeout(3_000)
    await expect(handle.page.locator('[data-testid="update-available"]')).toHaveCount(0)
  } finally {
    await handle.app.close()
    await fixture.close()
  }
})

test('the header does not change height when the banner arrives', async () => {
  // ADR-0021 §6. The banner lands a second or two AFTER launch, whenever the
  // network answers — so a header sized by its contents would shift the entire
  // window downward under a cursor that may already be moving toward a control.
  // Zero layout cost at any moment is the requirement.
  //
  // Measured across two launches rather than before-and-after within one, which
  // would race the very arrival it is trying to measure.
  const heights: number[] = []
  for (const tag of [`v${CURRENT}`, 'v99.1.0']) {
    const fixture = await serveRelease({ tag_name: tag, html_url: 'https://example.invalid/r' })
    const handle = await launchAgainst(fixture.url)
    try {
      const banner = handle.page.locator('[data-testid="update-available"]')
      if (tag === 'v99.1.0') await expect(banner).toBeVisible({ timeout: 15_000 })
      else await handle.page.waitForTimeout(3_000)

      const box = await handle.page.locator('header.app-header').boundingBox()
      heights.push(box?.height ?? -1)

      // The banner must not have pushed the main area down either — that is the
      // consequence the fixed height exists to prevent.
      const main = await handle.page.locator('main.app-main').boundingBox()
      expect(main?.y).toBeCloseTo(box?.height ?? -1, 0)
    } finally {
      await handle.app.close()
      await fixture.close()
    }
  }
  expect(heights[0]).toBeGreaterThan(0)
  expect(heights[1]).toBe(heights[0])
})

test('a narrow window keeps the version and the dismiss button', async () => {
  // Found by looking at it, after every functional spec passed: the two chips
  // shrank proportionally, so at an ordinary 1280px window the update message
  // collapsed to "Versi…" — losing the version number, which is its entire
  // actionable content — and at 720px the chip was clipped mid-word with its
  // dismiss button off-screen and unclickable.
  //
  // Guarded by RELATIONSHIP rather than pixel value, the way panel-layout.spec
  // does it: the version must still be readable and the controls must still be
  // reachable, whatever the width.
  const fixture = await serveRelease({ tag_name: 'v99.1.0', html_url: 'https://example.invalid/r' })
  const handle = await launchAgainst(fixture.url)
  try {
    const banner = handle.page.locator('[data-testid="update-available"]')
    await expect(banner).toBeVisible({ timeout: 15_000 })

    await handle.page.setViewportSize({ width: 720, height: 700 })
    await expect(banner).toContainText('99.1.0')
    await expect(handle.page.locator('[data-testid="update-download"]')).toBeInViewport()
    await expect(handle.page.locator('[data-testid="update-dismiss"]')).toBeInViewport()

    // Reachable, not merely painted.
    await handle.page.click('[data-testid="update-dismiss"]')
    await expect(banner).toHaveCount(0)
  } finally {
    await handle.app.close()
    await fixture.close()
  }
})

test('an unreachable endpoint says nothing at all', async () => {
  // Every failure is silence (ADR-0021 §3). This is the shape a laptop off the
  // network takes, and it is the failure mode most users will actually hit.
  //
  // Bind a port and close it, so the port is genuinely dead and the connection
  // is REFUSED rather than hanging until main's timeout.
  const dead = await serveRelease({})
  await dead.close()

  const handle = await launchAgainst(dead.url)
  try {
    await handle.page.waitForTimeout(3_000)
    await expect(handle.page.locator('[data-testid="update-available"]')).toHaveCount(0)
    // And the app is entirely usable — a failed check costs the user nothing.
    await expect(handle.page.locator('[data-testid="dropzone"]')).toBeVisible()
  } finally {
    await handle.app.close()
  }
})

test('a rate-limited response says nothing either', async () => {
  // 403 is what an unauthenticated caller over the 60/hour limit gets. The body
  // is a real GitHub error shape, with no tag_name in it — the case that would
  // throw if the response were trusted to be a release.
  const fixture = await serveRelease({ message: 'API rate limit exceeded' }, 403)
  const handle = await launchAgainst(fixture.url)
  try {
    await handle.page.waitForTimeout(3_000)
    await expect(handle.page.locator('[data-testid="update-available"]')).toHaveCount(0)
  } finally {
    await handle.app.close()
    await fixture.close()
  }
})
