import { join } from 'node:path'
import { MCP_SERVER_KEY } from '../../shared/connect'

// The launch entry, client-neutral (ADR-0030 Decision 5) — and the two ways to
// say it out loud.
//
// ONE ENTRY, MANY SERIALISERS is the decision this file exists to enforce.
// Every client receives the same launch: `process.execPath`, the built shim,
// `--mcp`, the profile flag on a non-default profile, `ELECTRON_RUN_AS_NODE=1`.
// A client adapter *serialises* it — into `codex mcp add` argv, into JSON for
// Claude Desktop, into labelled fields for the manual fallback — and none
// composes one. A second place that decided what to launch would be a second
// place to get the Windows stdin finding wrong.
//
// Electron-free on purpose, like `mcp/pipePath.ts`: everything here is a pure
// derivation over strings, so the Windows shapes unit-test on Linux, which is
// the only machine our CI has.

/** One MCP server launch, in the shape Claude Desktop's config uses. */
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
 * Electron process never receives its stdin — a config pointing a client
 * straight at the app would hang forever on the primary target.
 *
 * The profile flag appears ONLY when this app is not on the default profile.
 * The pipe is named per-profile, so an app running on a throwaway `userData`
 * whose config omitted the flag would send the client to a universe with no app
 * in it — and a config for an ordinary install must stay free of
 * machine-specific paths it does not need.
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

/** Same entry, by value — what tells `connected` from `outdated`, for every
 *  client, however that client's own config spelled it. */
export function sameEntry(a: ServerEntry, b: ServerEntry): boolean {
  if (a.command !== b.command) return false
  if (a.args.length !== b.args.length) return false
  if (a.args.some((arg, i) => arg !== b.args[i])) return false
  const aEnv = a.env ?? {}
  const bEnv = b.env ?? {}
  const keys = new Set([...Object.keys(aEnv), ...Object.keys(bEnv)])
  return [...keys].every((key) => aEnv[key] === bEnv[key])
}

/**
 * The entry as arguments to `codex mcp add` (ADR-0030 Decision 2, mechanism 1).
 *
 * The grammar is the one probed on the requesting machine and recorded in the
 * ADR's Context: `add <name> [--env K=V]… -- <command> [args…]`. The `--` is
 * load-bearing and is why this is a builder rather than a template — without
 * it, an arg of ours that starts with a dash (`--mcp`, `--user-data-dir=`) is
 * Codex's flag to parse, not the server's.
 *
 * Returned as ARGV, not a string: this is what gets spawned, and a spawn with
 * an argument vector has no quoting problem to get wrong. Quoting enters only
 * where a human has to retype it — see `quotedCommandLine`.
 */
export function codexAddArgv(entry: ServerEntry, key: string = MCP_SERVER_KEY): string[] {
  const env = Object.entries(entry.env ?? {}).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`
  ])
  return ['mcp', 'add', key, ...env, '--', entry.command, ...entry.args]
}

/**
 * The entry as fields a person retypes into a client's own "add a server" form
 * (ADR-0030 Decision 2, mechanism 3 — revised 2026-09-02, see the ADR's second
 * addendum).
 *
 * ONE FIELD PER BOX, and that is the whole reason this is not a string. Codex's
 * form — Settings → Plugins → MCPs → Add → "Connect to a custom MCP" — takes
 * the command in one box and then EACH ARGUMENT IN ITS OWN, added a row at a
 * time, with environment variables as separate Key and Value inputs. A pasteable
 * command line is the wrong artifact for that form: the user would have to split
 * it by hand, at exactly the moment they are already stuck, and the paths in it
 * contain the spaces that make splitting it by hand go wrong.
 *
 * The labels are the client's own words, not ours. Someone copying a value is
 * looking at their screen and at ours, and a mismatch in wording is a reason to
 * doubt they are in the right place.
 */
export function codexManualFields(
  entry: ServerEntry,
  key: string = MCP_SERVER_KEY
): { label: string; value: string }[] {
  return [
    { label: 'Name', value: key },
    { label: 'Type', value: 'STDIO' },
    { label: 'Command to launch', value: entry.command },
    ...entry.args.map((arg, i) => ({ label: `Argument ${i + 1}`, value: arg })),
    ...Object.entries(entry.env ?? {}).map(([name, value]) => ({
      label: `Environment variable — ${name}`,
      value
    }))
  ]
}
