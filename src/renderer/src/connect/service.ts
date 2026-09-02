import {
  CONNECT_CLIENT_LABELS,
  type ClientStatus,
  type ConnectClientId
} from '../../../shared/connect'

// The renderer's whole share of the connect surface (ADR-0030): ask main where
// this build stands with each MCP client, and — if the user clicks a row —
// ask it to connect that one. No path, no command, no config content; every
// client's config stays entirely main's business (see `shared/connect.ts`).

/**
 * The status when we cannot even ask.
 *
 * TOTAL like the storage and update services — a rejected invoke, or a
 * renderer that somehow loaded without the preload, must not throw into a
 * render. But unlike the update check it is NOT silent: this feature only ever
 * runs because a person asked, so its failures are theirs to see.
 *
 * It names the client, because after ADR-0030 the answer is a list and a row
 * that vanished on error would be indistinguishable from a client we chose not
 * to show.
 */
function unreachable(id: ConnectClientId): ClientStatus {
  return {
    id,
    displayName: CONNECT_CLIENT_LABELS[id],
    state: 'error',
    location: '',
    problem: `Carton Fit could not reach its own main process to check the ${CONNECT_CLIENT_LABELS[id]} config.`
  }
}

/**
 * Every registered client's state.
 *
 * The unreachable case answers for Claude Desktop alone rather than for every
 * id in the union: main is the authority on which clients are registered, and
 * inventing rows for clients this build may not carry would be the renderer
 * guessing at main's registry — the exact thing the id lookup exists to stop.
 */
export async function connectStatus(): Promise<ClientStatus[]> {
  try {
    return await window.api.connect.status()
  } catch {
    return [unreachable('claude-desktop')]
  }
}

export async function connectClient(id: ConnectClientId): Promise<ClientStatus> {
  try {
    return await window.api.connect.connect(id)
  } catch {
    return unreachable(id)
  }
}
