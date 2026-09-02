import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_SERVER_KEY } from '../shared/claudeConnect'

// The Electron-free half of "Connect to Claude" (ADR-0029, slice
// `connect-to-claude-button`): where Claude Desktop's config lives, what our
// entry in it looks like, and how one merges into a file we did not write.
//
// Split out for the same reason `mcp/pipePath.ts` is: everything here is a
// PURE derivation over strings, and the failures worth fearing — a path that
// is right on one OS, a merge that eats somebody's other servers — are exactly
// the ones a unit test can pin without an app, a filesystem, or Claude Desktop
// installed. `claudeConnect.ts` holds the half that touches the disk and the
// IPC boundary.
//
// This is the LAST slice of ADR-0029 on purpose, because the config entry it
// writes IS the shim's launch contract, and there was no point writing a
// contract before the thing it describes existed.
//
// ADR-0029 resolved setup as "a button, not JSON": the audience is
// non-technical internal users, and a feature whose install step is
// hand-editing another program's config file is a feature most of them will
// not have. So the app writes the `mcpServers` entry itself.
//
// TWO RULES GOVERN EVERYTHING BELOW, and both come from the same fact — this
// module writes a file that belongs to ANOTHER APPLICATION:
//
//   1. MERGE, NEVER CLOBBER. Other servers in that config are other people's
//      work; losing them is a worse outcome than not connecting.
//   2. WHEN IN DOUBT, REFUSE AND SAY SO. A config we cannot parse is not a
//      blank slate — it is a file whose contents we cannot see, which may hold
//      exactly the entries rule 1 protects. Failure here is loud (the ADR's
//      own sequencing note), because a silent one leaves a button that looks
//      like it worked and a Claude Desktop that never connects.

/**
 * Claude Desktop's config directories, in the order they should be tried.
 *
 * PLURAL, and that is the whole point — found by dogfooding on 2026-09-02,
 * where an install that was plainly there reported "Claude Desktop isn't
 * installed". **Windows has two locations, because Claude Desktop ships two
 * ways.** The Microsoft Store build is MSIX-packaged, and MSIX VIRTUALIZES
 * `%APPDATA%`: the packaged app writes what it sees as
 * `%APPDATA%\Claude\claude_desktop_config.json`, and Windows silently
 * redirects it to
 * `%LOCALAPPDATA%\Packages\Claude_<publisher>\LocalCache\Roaming\Claude\`.
 * Carton Fit is NOT packaged, so it sees the real `%APPDATA%\Claude` — which
 * on a Store-only machine does not exist at all. Both processes are "right"
 * about `%APPDATA%`; they are simply not looking at the same filesystem.
 *
 * So the Store location is tried FIRST on win32, then the classic one. The
 * package folder is matched by prefix rather than hardcoded: the name is
 * `Claude_<publisher hash>`, and a publisher hash is not ours to pin.
 *
 * macOS has one location. Linux has no first-party desktop build; the
 * community packages use the ordinary XDG config root, which is also what
 * makes this feature testable on our Linux CI.
 *
 * `CLAUDE_DESKTOP_CONFIG_DIR` lets tests own the path, the same seam ADR-0021
 * gives the update check — and it collapses the list to one, so a test is
 * never at the mercy of what is installed on the machine running it.
 *
 * @param msixPackages names of the `Claude_*` folders found under
 * `%LOCALAPPDATA%\Packages`. Passed IN rather than read here, so this stays a
 * pure derivation over strings and the Windows shapes unit-test on Linux.
 */
export function claudeConfigCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  msixPackages: readonly string[] = []
): string[] {
  const override = env['CLAUDE_DESKTOP_CONFIG_DIR']
  if (override !== undefined && override.length > 0) return [override]

  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    const roaming = env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    return [
      ...msixPackages.map((name) =>
        join(localAppData, 'Packages', name, 'LocalCache', 'Roaming', 'Claude')
      ),
      join(roaming, 'Claude')
    ]
  }
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Claude')]
  return [join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'Claude')]
}

/** The config file inside one of those directories. */
export function claudeConfigFile(dir: string): string {
  return join(dir, 'claude_desktop_config.json')
}

export interface ChosenConfigDir {
  readonly dir: string
  /** Whether Claude Desktop appears to be installed at all. */
  readonly found: boolean
}

/**
 * Pick the directory to read and write, given what is actually on disk.
 *
 * A candidate that already HOLDS a config wins outright, ahead of one that
 * merely exists: on a machine with both a Store and a classic Claude Desktop,
 * the file is the evidence of which one is really in use, while an empty
 * directory is evidence of nothing. Only if no candidate has a config does
 * mere existence decide, in candidate order.
 *
 * When nothing is found the LAST candidate is returned as the dir — the
 * classic `%APPDATA%\Claude` on Windows — because that path is the one worth
 * showing a user in a "not installed" message. Predicates are injected so the
 * rule itself is pure and every branch is unit-testable without a filesystem.
 */
export function chooseConfigDir(
  candidates: readonly string[],
  exists: (path: string) => boolean,
  hasConfig: (path: string) => boolean
): ChosenConfigDir {
  const withConfig = candidates.find((dir) => hasConfig(claudeConfigFile(dir)))
  if (withConfig !== undefined) return { dir: withConfig, found: true }
  const present = candidates.find((dir) => exists(dir))
  if (present !== undefined) return { dir: present, found: true }
  return { dir: candidates[candidates.length - 1] ?? '', found: false }
}

/** One `mcpServers` value, in Claude Desktop's own shape. */
export interface ServerEntry {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

/**
 * The entry that launches THIS build's shim.
 *
 * It is the `--mcp` invocation the e2e specs already drive (`e2e/mcpClient.ts`)
 * — deliberately, since a config describing a launch nothing has ever run is a
 * guess. One rule covers packaged and dev because `process.execPath` is the
 * Electron binary in both: shipped it is the installed app, in a checkout it is
 * `node_modules/electron`. What differs is only where `appPath` lands, and that
 * comes from the same `resolveAppRoot` derivation the two server modes use.
 *
 * `ELECTRON_RUN_AS_NODE` is the mechanism, not an accident (the footgun
 * CLAUDE.md warns the dev shell about, used on purpose): the shim must be a
 * plain Node process, because ADR-0029's Windows finding says a GUI-subsystem
 * Electron process never receives its stdin — a config pointing Claude Desktop
 * straight at the app would hang forever on the primary target.
 *
 * The profile flag appears ONLY when this app is not on the default profile.
 * The pipe is named per-profile, so an app running on a throwaway `userData`
 * whose config omitted the flag would send Claude to a universe with no app in
 * it — and a config for an ordinary install must stay free of machine-specific
 * paths it does not need.
 */
export function shimEntry(facts: {
  execPath: string
  appPath: string
  userData: string
  defaultUserData: string
}): ServerEntry {
  const args = [join(facts.appPath, 'out', 'main', 'mcp.js'), '--mcp']
  if (facts.userData !== facts.defaultUserData) args.push(`--user-data-dir=${facts.userData}`)
  return { command: facts.execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Same entry, by value — what tells `connected` from `outdated`. */
export function sameEntry(a: ServerEntry, b: ServerEntry): boolean {
  if (a.command !== b.command) return false
  if (a.args.length !== b.args.length) return false
  if (a.args.some((arg, i) => arg !== b.args[i])) return false
  const aEnv = a.env ?? {}
  const bEnv = b.env ?? {}
  const keys = new Set([...Object.keys(aEnv), ...Object.keys(bEnv)])
  return [...keys].every((key) => aEnv[key] === bEnv[key])
}

export type ConfigRead =
  | { readonly ok: true; readonly config: Record<string, unknown>; readonly entry: ServerEntry | null }
  | { readonly ok: false; readonly problem: string }

/**
 * Parse a config we are about to merge into — or refuse, with the sentence a
 * person needs.
 *
 * `null` (no file) and an empty file are BOTH a fresh start: Claude Desktop
 * ships without this file, so its absence is the ordinary case, not damage.
 * Everything else that is not a JSON object — including an `mcpServers` that is
 * not one — is refused rather than replaced, because rule 1 above cannot be
 * honoured for entries we cannot see.
 */
export function readConfig(text: string | null, key: string = CLAUDE_SERVER_KEY): ConfigRead {
  if (text === null || text.trim().length === 0) return { ok: true, config: {}, entry: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      problem:
        'Claude Desktop’s config file is not valid JSON, so it was left untouched. ' +
        'Fix or remove the file and try again.'
    }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, problem: 'Claude Desktop’s config file is not a JSON object, so it was left untouched.' }
  }

  const servers = parsed['mcpServers']
  if (servers !== undefined && !isPlainObject(servers)) {
    return {
      ok: false,
      problem: 'Claude Desktop’s config has an “mcpServers” that is not a list of servers, so it was left untouched.'
    }
  }

  const existing = servers === undefined ? undefined : servers[key]
  if (!isPlainObject(existing)) return { ok: true, config: parsed, entry: null }

  // Shape-checked rather than cast: this came off someone's disk. An entry we
  // cannot read as an entry counts as absent, which makes Connect overwrite it
  // — the right outcome, since it is ours by key and it is not working.
  const command = existing['command']
  const args = existing['args']
  if (typeof command !== 'string' || !Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return { ok: true, config: parsed, entry: null }
  }
  const env = isPlainObject(existing['env'])
    ? Object.fromEntries(
        Object.entries(existing['env']).filter(([, v]) => typeof v === 'string') as [string, string][]
      )
    : undefined
  return { ok: true, config: parsed, entry: { command, args: args as string[], env } }
}

/**
 * The merged file's text.
 *
 * Spreading rather than rebuilding keeps every key we did not come for —
 * including their order, so a user's hand-edited file does not come back
 * reshuffled — and two-space JSON with a trailing newline matches what Claude
 * Desktop itself writes, which keeps this from showing up as a whole-file diff
 * in anyone's dotfile repo.
 */
export function mergeEntry(
  config: Record<string, unknown>,
  entry: ServerEntry,
  key: string = CLAUDE_SERVER_KEY
): string {
  const servers = isPlainObject(config['mcpServers']) ? config['mcpServers'] : {}
  const merged = { ...config, mcpServers: { ...servers, [key]: entry } }
  return `${JSON.stringify(merged, null, 2)}\n`
}

