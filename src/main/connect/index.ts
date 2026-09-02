import { ipcMain } from 'electron'
import { CONNECT_CHANNELS, type ClientStatus, type ConnectClientId } from '../../shared/connect'
import { claudeDesktopClient } from './claude'
import { codexClient } from './codex'

// The connect registry (ADR-0030 Decision 1) — the trunk every client adapter
// hangs on, and the one place an id becomes code.
//
// ADR-0029 shipped one client by writing its config file directly. ADR-0030's
// lesson from the MSIX finding is that the FILE is the wrong seam: where a
// client keeps its config, how it formats it and what else lives in it are all
// the client's to change. So the seam is the CLIENT, and how it is reached —
// its own tooling, its file, or copyable text — is that adapter's business.
//
// THE SECURITY LINE IS `resolve()` BELOW. ADR-0029's property was that page
// content can nominate neither a file for the app to write nor a program for a
// client to run, and it held trivially because `connect()` took no argument.
// It now takes one, so the property is held by lookup instead: an id is a key
// into a registry MAIN populated, never a path, a command, or content. An
// unregistered id is refused before anything is read or written.

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
/**
 * ASYNC, though the first client had no need to be. Claude Desktop's adapter
 * reads a small JSON file and answers in microseconds; Codex's spawns
 * `codex.exe`, which is a 293 MB binary on the requesting machine. Answering
 * that synchronously would freeze the window — including its animation frames
 * and its packing worker's message pump — for as long as another company's
 * program takes to boot. The IPC boundary was already a promise on the
 * renderer's side, so this costs nothing but an `async` keyword on the client
 * that does not need it.
 */
export interface ConnectClient {
  readonly id: ConnectClientId
  readonly displayName: string
  /** Look, change nothing. Total: every failure arrives as `state: 'error'`. */
  status(): Promise<ClientStatus>
  /** Write (or refresh) this build's entry, then read the state back. */
  connect(): Promise<ClientStatus>
}

/** Registration order is display order — the confirmed client first
 *  (ADR-0030: Claude Desktop is proven by dogfooding, Codex is not yet). */
const CLIENTS: readonly ConnectClient[] = [claudeDesktopClient, codexClient]

/**
 * An id to the client that registered it, or a refusal.
 *
 * Throwing rather than returning a `not-detected` status is deliberate: an
 * unknown id is not a machine without that client installed, it is a caller
 * that should not exist. It reaches the renderer as a rejected invoke, which
 * its service turns into a loud error row.
 */
function resolve(id: unknown): ConnectClient {
  const client = CLIENTS.find((candidate) => candidate.id === id)
  if (client === undefined) throw new Error(`Unknown connect client: ${String(id)}`)
  return client
}

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
    resolve(id).connect()
  )
}
