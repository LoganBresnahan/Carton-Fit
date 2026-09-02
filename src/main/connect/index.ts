import { ipcMain } from 'electron'
import { CONNECT_CHANNELS, type ClientStatus } from '../../shared/connect'
import { claudeDesktopClient } from './claude'
import { codexClient } from './codex'
import { pickClient, type ConnectClient } from './registry'

export type { ConnectClient } from './registry'

// The connect registry (ADR-0030 Decision 1) — the trunk every client adapter
// hangs on, and the one place an id becomes code.
//
// ADR-0029 shipped one client by writing its config file directly. ADR-0030's
// lesson from the MSIX finding is that the FILE is the wrong seam: where a
// client keeps its config, how it formats it and what else lives in it are all
// the client's to change. So the seam is the CLIENT, and how it is reached —
// its own tooling, its file, or copyable text — is that adapter's business.
//
// THE SECURITY LINE IS `pickClient` in `registry.ts` — Electron-free so its
// refusal of an unregistered id is pinned by a unit test rather than trusted.

/**
 * One client, behind one interface.
 *
 * Note what is NOT a member: `detect()`. ADR-0030's sketch shows one, because
 * the Claude adapter has a directory probe by that name — but detection is not
 * a thing the seam ever needs to call separately. Every adapter already has to
 * answer "is it here?" as part of `status()`, and it answers in the vocabulary
 * the panel speaks (`not-detected`). Codex detects by finding a CLI and Claude
 * by finding a directory; making that a second public member would put the
 * *mechanism* back in the interface, which is the thing this ADR moved out.
 */
/** Registration order is display order — the confirmed client first
 *  (ADR-0030: Claude Desktop is proven by dogfooding, Codex is not yet). */
const CLIENTS: readonly ConnectClient[] = [claudeDesktopClient, codexClient]

/**
 * Every registered client's state, in registration order.
 *
 * CONCURRENTLY, and the order is restored by `Promise.all` rather than by
 * asking one client to wait for another: a Codex install that takes a second to
 * answer must not delay the Claude row, and the panel renders both together.
 */
export function connectStatus(): Promise<ClientStatus[]> {
  return Promise.all(CLIENTS.map((client) => client.status()))
}

export function registerConnectIpc(): void {
  ipcMain.handle(CONNECT_CHANNELS.status, (): Promise<ClientStatus[]> => connectStatus())
  ipcMain.handle(CONNECT_CHANNELS.connect, (_event, id: unknown): Promise<ClientStatus> =>
    pickClient(CLIENTS, id).connect()
  )
}
