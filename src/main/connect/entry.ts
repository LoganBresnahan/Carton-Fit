import { join } from 'node:path'
import { MCP_SERVER_KEY } from '../../shared/connect'

// The launch entry, client-neutral (ADR-0030 Decision 5) — and the two ways to
// say it out loud.
//
// ONE ENTRY, MANY SERIALISERS is the decision this file exists to enforce.
// Every client receives the same launch: `process.execPath`, the built shim,
// `--mcp`, the profile flag on a non-default profile, `ELECTRON_RUN_AS_NODE=1`.
// A client adapter *serialises* it — into JSON for Claude Desktop, into `codex
// mcp add` argv for Codex, into copyable text for the fallback — and none
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
 * Tokens as one command line a person can paste — the copyable fallback
 * (ADR-0030 Decision 2, mechanism 3), which is the one that has to work on the
 * machine we did not anticipate.
 *
 * QUOTED FOR `CommandLineToArgvW`, which is Windows' own rule for turning a
 * command line back into an argv: a run of backslashes is literal unless it
 * precedes a quote, in which case it doubles. That is the rule `cmd` hands
 * through and the one PowerShell reproduces for the shapes we emit. The shape
 * neither shell agrees on is an argument containing a literal quote — and ours
 * never does: it is a program path, a script path, `--mcp`, a profile path,
 * and `K=V`. If that ever stops being true this needs a per-shell answer, not
 * a cleverer quoter.
 *
 * The audience is `C:\Program Files\Carton Fit\Carton Fit.exe` and a Windows
 * username with a space in it — the paths that are ordinary on the primary
 * target and that an unquoted join silently splits in two.
 */
export function quotedCommandLine(tokens: readonly string[]): string {
  return tokens.map(quoteToken).join(' ')
}

function quoteToken(token: string): string {
  if (token.length > 0 && !/[\s"]/.test(token)) return token
  let quoted = '"'
  let backslashes = 0
  for (const char of token) {
    if (char === '\\') {
      backslashes += 1
      continue
    }
    if (char === '"') {
      // Every backslash run before a quote doubles, then the quote escapes.
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      quoted += '\\'.repeat(backslashes) + char
    }
    backslashes = 0
  }
  // A trailing run doubles too, or it would escape the closing quote itself.
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`
}

/**
 * A command line back into tokens — `CommandLineToArgvW`'s rule, read the other
 * way.
 *
 * It exists to make `quotedCommandLine` testable against something other than
 * itself: the unit tests round-trip a Windows-shaped entry through both and
 * compare with `sameEntry`. Be clear about what that proves — two independent
 * readings of one documented rule agree. It is NOT proof that a given shell
 * agrees, which is dogfooding's job (ADR-0030 §7).
 */
export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = []
  let token = ''
  let started = false
  let inQuotes = false
  let backslashes = 0

  const flushBackslashes = (beforeQuote: boolean): boolean => {
    // Halve them before a quote; the quote is literal iff the run was odd.
    token += '\\'.repeat(beforeQuote ? Math.floor(backslashes / 2) : backslashes)
    const literalQuote = beforeQuote && backslashes % 2 === 1
    backslashes = 0
    return literalQuote
  }

  for (const char of line) {
    if (char === '\\') {
      backslashes += 1
      started = true
      continue
    }
    if (char === '"') {
      if (flushBackslashes(true)) token += '"'
      else inQuotes = !inQuotes
      started = true
      continue
    }
    if (/\s/.test(char) && !inQuotes) {
      flushBackslashes(false)
      if (started) tokens.push(token)
      token = ''
      started = false
      continue
    }
    flushBackslashes(false)
    token += char
    started = true
  }
  flushBackslashes(false)
  if (started) tokens.push(token)
  return tokens
}
