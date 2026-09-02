import { expect, test } from '@playwright/test'
import { launchApp } from './harness'

/**
 * Server mode's LIFECYCLE (ADR-0029, slice `hidden-launch-show-on-drive`).
 *
 * Claude Desktop starts an MCP server when it starts, not when someone asks a
 * question — so an app that showed its window on launch would appear on screen
 * because a chat client booted. `--mcp-server` therefore launches hidden and
 * reveals on the first drive call.
 *
 * Two things about that touch EVERY user, not just server mode, which is why
 * they are pinned here rather than left to dogfooding (build-plan sequencing
 * risk 3): the window still shows normally without the flag, and the plain
 * desktop app still quits when its window closes. Both are asserted in both
 * directions below.
 *
 * The one claim these specs cannot reach is the reveal itself: it fires from
 * the drive bridge, which needs an MCP client on stdin, and Playwright's
 * Electron launch gives the child no writable stdin. What IS covered is that
 * every drive call routes through `ensureWindow` (mcp-drive.spec.ts fails
 * outright otherwise) and that the window starts hidden — the reveal is the
 * dogfooding step in between.
 */

test('the app launched normally shows its window', async () => {
  // The control. Without it, a hidden-by-default regression would pass the
  // spec below and break the product for everyone who is not Claude.
  const { app } = await launchApp()
  try {
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isVisible()
    )
    expect(visible).toBe(true)
  } finally {
    await app.close()
  }
})

test('--mcp-server launches with the window loaded but hidden', async () => {
  const { app, page } = await launchApp(['--mcp-server'])
  try {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return { windows: BrowserWindow.getAllWindows().length, visible: win?.isVisible() }
    })
    // LOADED, not merely absent: the window exists and its renderer is running,
    // so the first drive call reveals a ready app instead of waiting out a
    // cold boot. `launchApp` already waited for the dropzone, which is the
    // renderer having painted — a window that was never created could not have.
    expect(state).toEqual({ windows: 1, visible: false })
    await expect(page.locator('[data-testid="dropzone"]')).toBeAttached()
  } finally {
    await app.close()
  }
})

test('closing the window quits the plain app, and does NOT quit a server', async () => {
  // The `window-all-closed` carve-out, in both directions. Getting this wrong
  // in one direction leaves an orphan process behind on every quit; in the
  // other it kills a server Claude Desktop is still holding, and the next tool
  // call fails as a transport error rather than an answer.
  const plain = await launchApp()
  await plain.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  // Resolves only if the app actually exits.
  await plain.app.waitForEvent('close', { timeout: 15_000 })

  const server = await launchApp(['--mcp-server'])
  try {
    await server.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    // WAIT FOR THE QUIT THAT MUST NOT COME. Polling the window count instead
    // proved nothing: the first poll answered before the process had finished
    // exiting, so the assertion passed with the carve-out deleted. The only
    // honest shape is to give a quit time to happen and require that it did
    // not — the plain app above needs well under this to exit.
    const outcome = await server.app
      .waitForEvent('close', { timeout: 4_000 })
      .then(() => 'quit')
      .catch(() => 'still running')
    expect(outcome).toBe('still running')
    expect(server.app.process().exitCode).toBeNull()
    // …and with no window left, so this is the carve-out and not a window that
    // simply refused to close.
    expect(
      await server.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    ).toBe(0)
  } finally {
    await server.app.close()
  }
})
