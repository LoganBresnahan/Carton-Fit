// The "Connect to Claude" contract, shared by all three processes (ADR-0029,
// build-plan slice `connect-to-claude-button`).
//
// Same discipline as `shared/update.ts`: TYPES AND CONSTANTS ONLY, because this
// file is imported into the renderer bundle and must not drag Electron or
// node: modules in with it.
//
// The split of responsibility is the decision, and it is ADR-0021's split
// applied to a filesystem instead of a network. MAIN owns the config path, the
// launch command it writes there, and every read and write of a file belonging
// to another application. The RENDERER owns only the sentence on screen and the
// click. Note what is NOT here: no path, no command, and no config content
// travels renderer→main. `connect()` takes no argument, so page content cannot
// nominate a file for the app to write or a program for Claude Desktop to run —
// which is what this feature would otherwise be.

export const CLAUDE_CONNECT_CHANNELS = {
  status: 'claude-connect:status',
  connect: 'claude-connect:connect'
} as const

/**
 * Where this build stands in Claude Desktop's config.
 *
 * `error` is deliberately NOT collapsed into the others, which is the opposite
 * of ADR-0021's silence rule and for the opposite reason: an update check is
 * something the app decided to do, so its failure is nobody's business, while
 * connecting is something the user just asked for. A failure here has to be
 * loud, because the alternative is a button that appears to work and a Claude
 * Desktop that never connects (build-plan sequencing risk 5).
 */
export type ClaudeConnectState =
  /** Our entry is present and names exactly this build's launch command. */
  | 'connected'
  /** An entry under our key is present but points somewhere else — the usual
   *  cause is an app that moved, or a profile that changed. Re-connecting
   *  fixes it, so the UI offers that rather than reporting a fault. */
  | 'outdated'
  /** Claude Desktop is there; we are not in its config yet. */
  | 'not-connected'
  /** No Claude Desktop config directory. The app is very likely not installed,
   *  and writing a config for an absent program is litter, so we don't. */
  | 'claude-not-found'
  /** The config could not be read, parsed, or written. `problem` says why. */
  | 'error'

export interface ClaudeConnectStatus {
  readonly state: ClaudeConnectState
  /** The file this build reads and writes — shown so a user who prefers to
   *  edit JSON by hand, or who has to report a problem, knows where to look. */
  readonly configPath: string
  /** One sentence, already written for a person. Present only for `error`. */
  readonly problem?: string
}

export interface ClaudeConnectApi {
  /** Look, change nothing. Total: every failure arrives as `state: 'error'`. */
  status(): Promise<ClaudeConnectStatus>
  /**
   * Write (or refresh) this build's `mcpServers` entry, then report the state
   * that write left behind — so the caller never has to ask twice, and what it
   * displays is read back from the file rather than assumed from a resolved
   * promise.
   */
  connect(): Promise<ClaudeConnectStatus>
}

/**
 * Our key inside `mcpServers`. Stable across versions and profiles ON PURPOSE:
 * it is the identity that lets a re-connect REPLACE the entry a previous build
 * wrote instead of accumulating one entry per install location.
 */
export const CLAUDE_SERVER_KEY = 'carton-fit'
