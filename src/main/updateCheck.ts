import { app, ipcMain, net, shell } from 'electron'
import { UPDATE_CHANNELS, type UpdateInfo } from '../shared/update'
import { isNewerVersion } from './version'

// The update check (ADR-0021): find out whether a newer release exists, say so
// once, and hand over the download link. Nothing downloads, nothing installs,
// nothing blocks.
//
// Why not electron-updater: the installer is unsigned, so auto-installing does
// not remove the SmartScreen moment — it relocates it to one the user did not
// initiate. It is also a runtime dependency plus a server-side release contract
// (`latest.yml`, staged rollouts, differential updates) sized for a cadence this
// project does not have. See the ADR's alternatives.

/**
 * Only PUBLISHED, non-draft, non-prerelease releases come back from this
 * endpoint. That is load-bearing: ADR-0012 makes CI build drafts and a human
 * publish after dogfooding, so a draft that dogfooding rejects is invisible to
 * every installed copy without this file knowing anything about it.
 */
const RELEASES_API = 'https://api.github.com/repos/LoganBresnahan/Carton-Fit/releases/latest'

/** Where Download goes if the response somehow omits the release's own page. */
const RELEASES_PAGE = 'https://github.com/LoganBresnahan/Carton-Fit/releases/latest'

/**
 * Short on purpose. Nothing waits on this — the window is already up and the
 * app is fully usable — so a slow network should cost a banner, not a pending
 * request held open for the session.
 */
const TIMEOUT_MS = 5_000

interface Found {
  readonly info: UpdateInfo
  /** Kept in main and never sent to the renderer — see `shared/update.ts`. */
  readonly url: string
}

/**
 * The launch check, started once and reused.
 *
 * Memoizing the PROMISE rather than the result is what keeps "once per launch"
 * true: the renderer asks on mount, and the e2e harness reloads the page on
 * every launch, so a per-request check would double the traffic and make the
 * 60/hour unauthenticated rate limit a function of how often a window reloads.
 */
let pending: Promise<Found | null> | null = null

async function fetchLatest(): Promise<Found | null> {
  // Tests own the URL (ADR-0021): the e2e points this at a local fixture, which
  // is the only way to exercise both the found and the silent paths without
  // depending on what is actually published on GitHub today.
  const url = process.env['UPDATE_CHECK_URL'] ?? RELEASES_API

  // net.fetch rather than node:https or a dependency: it is Electron's own
  // stack, so it inherits the system proxy configuration a corporate machine is
  // likely to need.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) return null

    // Everything below treats the body as untrusted shape, not as the schema
    // the docs promise. A 200 carrying something unexpected is a "say nothing"
    // case exactly like a 403.
    const body: unknown = await response.json()
    const record = (body ?? {}) as Record<string, unknown>

    const tag = typeof record['tag_name'] === 'string' ? record['tag_name'] : null
    if (tag === null || !isNewerVersion(tag, app.getVersion())) return null

    const page = typeof record['html_url'] === 'string' ? record['html_url'] : RELEASES_PAGE
    return { info: { version: tag.trim().replace(/^v/, '') }, url: page }
  } catch {
    // Offline, DNS failure, TLS trouble, the abort above, a body that is not
    // JSON. Every one of them means silence (ADR-0021 §3) — a packing estimator
    // must never nag about the network, and a scary message about a check the
    // user did not ask for is worse than no message at all.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Begin the check. Called once the window is showing, so it cannot delay the
 * app appearing — the same reasoning ADR-0007 applies to opening the database.
 */
export function startUpdateCheck(): void {
  pending ??= fetchLatest()
}

export function registerUpdateIpc(): void {
  ipcMain.handle(UPDATE_CHANNELS.check, async (): Promise<UpdateInfo | null> => {
    // `??=` rather than assuming startUpdateCheck ran: the renderer asking is a
    // fine reason to start, and it keeps this handler correct if the launch
    // sequence is ever reordered.
    const found = await (pending ??= fetchLatest())
    return found?.info ?? null
  })

  ipcMain.handle(UPDATE_CHANNELS.openRelease, async (): Promise<void> => {
    const found = await pending
    // Silently do nothing rather than opening a fallback page: reaching here
    // with no result means the banner was never shown, so there is no user
    // gesture this could plausibly belong to.
    if (found !== null) await shell.openExternal(found.url)
  })
}
