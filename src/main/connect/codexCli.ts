import { join } from 'node:path'

// Finding Codex's CLI (ADR-0030 Decision 4) — the whole of Codex detection.
//
// DETECTION IS THE CLI, NOT THE FILE, and that is the decision rather than a
// convenience. A fresh Codex install may have no `config.toml` at all — the CLI
// creates it — so a file probe reports "not installed" for a user who has the
// program. It is also the location we least want to depend on: ADR-0030 exists
// because ADR-0029 learned what depending on another app's filesystem costs.
//
// WHAT THIS MODULE MUST NEVER DO, both from Decision 3 and 4:
//   1. read or write `config.toml` — Codex owns its TOML, and every question we
//      have about it is answered by `codex mcp get/add` instead;
//   2. read the `CODEX_CLI_PATH` breadcrumb the desktop app leaves inside
//      another server's `env` block. It is an internal detail of a bundled
//      plugin, not a contract — and reading it would mean parsing the very file
//      rule 1 refuses.
//
// Electron-free and injected all the way down, modelled on
// `claudeConfigCandidates`: every branch here is a Windows branch, and the only
// machine our CI has is Linux.

/** One directory under Codex's versioned `bin`, with the mtime that ranks it. */
export interface BinDir {
  readonly name: string
  readonly mtimeMs: number
}

export interface CodexLookup {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly home: string
  /** Contents of `%LOCALAPPDATA%\OpenAI\Codex\bin`; empty when absent or
   *  unreadable, which simply means no desktop install was found. */
  listBinDirs: (root: string) => readonly BinDir[]
  exists: (path: string) => boolean
}

/** The versioned `bin` the Windows desktop install keeps its CLI under. */
export function codexBinRoot(env: NodeJS.ProcessEnv, home: string): string {
  const localAppData = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
  return join(localAppData, 'OpenAI', 'Codex', 'bin')
}

/**
 * Codex's config home — computed, and NEVER OPENED.
 *
 * It exists only to be handed to the CLI as its environment, so a user on a
 * non-default `CODEX_HOME` gets their own config written rather than a second
 * one appearing in `~/.codex`. We do not read it, list it, or check that it is
 * there; that is entirely the CLI's business (Decision 3).
 */
export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  const override = env['CODEX_HOME']
  if (override !== undefined && override.length > 0) return override
  return join(home, '.codex')
}

/**
 * The `codex` binary to run, or `null` when this machine has none.
 *
 * Order:
 *
 *   1. `CODEX_CLI`, which WINS OUTRIGHT and is not existence-checked. It is the
 *      seam the e2e fake CLI is installed through — the same shape
 *      `CLAUDE_DESKTOP_CONFIG_DIR` and `UPDATE_CHECK_URL` give their features —
 *      and a test that pointed it at a missing file wants a loud spawn failure,
 *      not a silent fall-through to whatever the machine happens to have.
 *   2. On Windows, the desktop install's versioned `bin`, newest first. The
 *      `bin` holds one directory per shipped version (two on the requesting
 *      machine, installed minutes apart by one update), and newest-by-mtime is
 *      a heuristic the ADR records as such. It is not blind: a newest directory
 *      with no `codex.exe` in it falls through to the next, so a half-written
 *      update does not read as "Codex is not installed".
 *   3. `PATH`. On Windows this is a DEPARTURE from the ADR's sketch, which
 *      gives Windows the desktop install and everywhere else `PATH`: an
 *      npm-installed `codex` on a Windows box is a real shape, and the only
 *      thing this fallback can change is `not-detected` → found. Elsewhere it
 *      is the whole of discovery — the npm CLI, the macOS app's bundled binary.
 */
export function findCodexCli(lookup: CodexLookup): string | null {
  const override = lookup.env['CODEX_CLI']
  if (override !== undefined && override.length > 0) return override

  if (lookup.platform === 'win32') {
    const root = codexBinRoot(lookup.env, lookup.home)
    const newestFirst = [...lookup.listBinDirs(root)].sort(
      // Name descending breaks an mtime tie. The names are version hashes, so
      // no ordering of them means anything — this one is merely STABLE, which
      // is the property that matters: the same machine must not resolve a
      // different CLI on two consecutive checks.
      (a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)
    )
    for (const dir of newestFirst) {
      const candidate = join(root, dir.name, 'codex.exe')
      if (lookup.exists(candidate)) return candidate
    }
  }

  // The separator comes from the INJECTED platform, not from `node:path`,
  // whose `delimiter` is the host's. Without that the Windows PATH branch is
  // unreachable from our only CI machine — and worse, a Windows PATH split on
  // ':' tears every `C:\...` entry in half.
  const names = lookup.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex']
  const separator = lookup.platform === 'win32' ? ';' : ':'
  for (const entry of (lookup.env['PATH'] ?? '').split(separator)) {
    // An empty PATH entry means the current directory to some shells. Resolving
    // it would let whatever directory the app happens to be in supply a program
    // we then run — so it is skipped, not treated as `.`.
    if (entry.length === 0) continue
    for (const name of names) {
      const candidate = join(entry, name)
      if (lookup.exists(candidate)) return candidate
    }
  }
  return null
}
