// The connect surface, shared by all three processes (ADR-0030) — one panel,
// many MCP clients, one seam.
//
// Same discipline as `shared/update.ts`: TYPES AND CONSTANTS ONLY, because this
// file is imported into the renderer bundle and must not drag Electron or
// node: modules in with it.
//
// This replaces `shared/claudeConnect.ts`, which said the same things about one
// client. ADR-0029's split of responsibility is unchanged and is still the
// decision: MAIN owns each client's config location, the launch command written
// there, and every read and write of a file belonging to another application.
// The RENDERER owns only the sentence on screen and the click.
//
// What the generalisation costs is exactly one line, and it is the line that
// keeps ADR-0029's security property. `connect()` used to take no argument at
// all, so page content could nominate neither a file for the app to write nor a
// program for a client to run. It now takes a client id — but an id is chosen
// from the set MAIN registered and is looked up there; it names no path, no
// command and no content. A renderer that invents an id gets a rejection, not a
// write.

export const CONNECT_CHANNELS = {
  status: 'connect:status',
  connect: 'connect:connect'
} as const

/**
 * The wire identity of a client.
 *
 * A closed union rather than a string, because it crosses the IPC boundary and
 * is used to select code in main. Both ids are declared here from the start:
 * the set is the contract, and an adapter arriving later fills one in (ADR-0030
 * Decision 1).
 */
export type ConnectClientId = 'claude-desktop' | 'codex'

/**
 * What each client is called, in one place.
 *
 * Main's adapters take their `displayName` from here rather than spelling it,
 * and the renderer uses it to name a client in a status it had to synthesise
 * because main never answered. A label is not a path or a command, so it is
 * safe on the renderer side of the split above.
 */
export const CONNECT_CLIENT_LABELS: Record<ConnectClientId, string> = {
  'claude-desktop': 'Claude Desktop',
  codex: 'ChatGPT (Codex)'
}

/**
 * Where this build stands with one client.
 *
 * `error` is deliberately NOT collapsed into the others, which is the opposite
 * of ADR-0021's silence rule and for the opposite reason: an update check is
 * something the app decided to do, so its failure is nobody's business, while
 * connecting is something the user just asked for. A failure here has to be
 * loud, because the alternative is a button that appears to work and a client
 * that never connects.
 */
export type ConnectState =
  /** Our entry is present and names exactly this build's launch command. */
  | 'connected'
  /** An entry under our key is present but points somewhere else — the usual
   *  cause is an app that moved, or a profile that changed. Re-connecting
   *  fixes it, so the UI offers that rather than reporting a fault. */
  | 'outdated'
  /** The client is there; we are not in its config yet. */
  | 'not-connected'
  /** The client itself was not found — no config directory, no CLI. It is very
   *  likely not installed, and writing a config for an absent program is
   *  litter, so we don't. Named for the *client*, not for Claude: this is the
   *  state a Linux machine without Codex reports too (ADR-0030 Consequences). */
  | 'not-detected'
  /** The config could not be read, parsed, or written. `problem` says why. */
  | 'error'

export interface ClientStatus {
  readonly id: ConnectClientId
  readonly displayName: string
  readonly state: ConnectState
  /**
   * The thing this build reads and writes for this client — a config file for
   * a file-mechanism client, the CLI binary for a tooling one (ADR-0030
   * Decision 2). Shown so a user who prefers to do it by hand, or who has to
   * report a problem, knows where to look. Empty when nothing was resolved.
   */
  readonly location: string
  /** One sentence, already written for a person. Present only for `error`. */
  readonly problem?: string
}

export interface ConnectApi {
  /**
   * Look, change nothing — one status per REGISTERED client, detected or not.
   * An undetected client is reported as `not-detected` rather than dropped, so
   * the panel can say "Codex isn't installed" instead of silently having no
   * opinion. Total: every failure arrives as `state: 'error'`.
   */
  status(): Promise<ClientStatus[]>
  /**
   * Connect one client, then report the state that left behind — so the caller
   * never has to ask twice, and what it displays is read back from the client
   * rather than assumed from a resolved promise.
   */
  connect(id: ConnectClientId): Promise<ClientStatus>
}

/**
 * Our key, in whichever client's config it lands.
 *
 * Stable across versions, profiles AND CLIENTS on purpose: it is the identity
 * that lets a re-connect REPLACE the entry a previous build wrote instead of
 * accumulating one entry per install location. One name, because it is one
 * entry (ADR-0030 Decision 5).
 */
export const MCP_SERVER_KEY = 'carton-fit'
