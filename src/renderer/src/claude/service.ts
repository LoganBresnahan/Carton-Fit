import type { ClaudeConnectStatus } from '../../../shared/claudeConnect'

// The renderer's whole share of "Connect to Claude" (ADR-0029, slice
// `connect-to-claude-button`): ask main where this build stands in Claude
// Desktop's config, and — if the user clicks — ask it to write the entry. No
// path, no command, no JSON; the config file stays entirely main's business
// (see `shared/claudeConnect.ts`).

/**
 * The status when we cannot even ask.
 *
 * TOTAL like the storage and update services — a rejected invoke, or a
 * renderer that somehow loaded without the preload, must not throw into a
 * render. But unlike the update check it is NOT silent: this feature only ever
 * runs because a person asked, so its failures are theirs to see.
 */
function unreachable(): ClaudeConnectStatus {
  return {
    state: 'error',
    configPath: '',
    problem: 'Carton Fit could not reach its own main process to check the Claude Desktop config.'
  }
}

export async function claudeStatus(): Promise<ClaudeConnectStatus> {
  try {
    return await window.api.claudeConnect.status()
  } catch {
    return unreachable()
  }
}

export async function claudeConnect(): Promise<ClaudeConnectStatus> {
  try {
    return await window.api.claudeConnect.connect()
  } catch {
    return unreachable()
  }
}
