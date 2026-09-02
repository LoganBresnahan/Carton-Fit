import type { ClientStatus, ConnectClientId } from '../../shared/connect'

// The registry's shape and its one lookup, Electron-free so the lookup can be
// pinned by a unit test. `index.ts` owns the actual list and the IPC.

/**
 * One client, behind one interface.
 *
 * ASYNC, though the first client had no need to be. Claude Desktop's adapter
 * reads a small JSON file and answers in microseconds; Codex's spawns
 * `codex.exe`, which is a 293 MB binary on the requesting machine. Answering
 * that synchronously would freeze the window — including its animation frames
 * and its packing worker's message pump — for as long as another company's
 * program takes to boot. The IPC boundary was already a promise on the
 * renderer's side, so this costs nothing but an `async` keyword on the client
 * that does not need it.
 *
 * Note what is NOT a member: `detect()`. ADR-0030's sketch shows one, because
 * the Claude adapter has a directory probe by that name — but detection is not
 * a thing the seam ever needs to call separately. Every adapter already has to
 * answer "is it here?" as part of `status()`, and it answers in the vocabulary
 * the panel speaks (`not-detected`). Codex detects by finding a CLI and Claude
 * by finding a directory; making that a second public member would put the
 * *mechanism* back in the interface, which is the thing this ADR moved out.
 */
export interface ConnectClient {
  readonly id: ConnectClientId
  readonly displayName: string
  /** Look, change nothing. Total: every failure arrives as `state: 'error'`. */
  status(): Promise<ClientStatus>
  /** Write (or refresh) this build's entry, then read the state back. */
  connect(): Promise<ClientStatus>
}

/**
 * An id to the client that registered it, or a refusal.
 *
 * THIS IS THE SECURITY LINE. ADR-0029's property was that page content can
 * nominate neither a file for the app to write nor a program for a client to
 * run, and it held trivially because `connect()` took no argument. It now
 * takes one, so the property is held by lookup instead: an id is a key into a
 * list MAIN populated, never a path, a command, or content. An unregistered id
 * is refused before anything is read or written.
 *
 * Throwing rather than returning a `not-detected` status is deliberate: an
 * unknown id is not a machine without that client installed, it is a caller
 * that should not exist. It reaches the renderer as a rejected invoke, which
 * its service turns into a loud error row.
 */
export function pickClient(clients: readonly ConnectClient[], id: unknown): ConnectClient {
  const client = clients.find((candidate) => candidate.id === id)
  if (client === undefined) throw new Error(`Unknown connect client: ${String(id)}`)
  return client
}
