import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CONNECT_CLIENT_LABELS, MCP_SERVER_KEY, type ClientStatus } from '../../shared/connect'
import {
  codexBinRoot,
  codexHome,
  findCodexCli,
  parseCodexGet,
  type BinDir
} from './codexCli'
import { codexAddArgv, sameEntry, shimEntry, type ServerEntry } from './entry'
import type { ConnectClient } from './index'
import { resolveAppRoot } from '../mcp/host'
import { defaultUserDataPath } from '../mcp/pipePath'

// The Codex client (ADR-0030 Decision 2, mechanism 1) — the half that spawns a
// program. Discovery and every pure derivation live in `codexCli.ts`.
//
// THE POINT OF THIS FILE IS WHAT IT DOES NOT DO. It never opens
// `~/.codex/config.toml`. Codex owns its TOML, in a format we have no parser
// for and no business round-tripping, and every question we have about that
// file is answered by asking Codex's own CLI instead. That is not a shortcut
// around a missing dependency; it is the rule the MSIX finding bought us —
// where a client ships tooling, the client's owner keeps it correct, and we
// inherit none of their assumptions about their own filesystem.
//
// A USER NEVER SEES THIS CLI. It ships inside the desktop app (verified on the
// requesting machine: `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`, from
// the Store MSIX, not on `PATH`), and we spawn it with no window and no
// terminal. The person clicks Connect. If they had to open a shell, the
// feature would have failed at its purpose (ADR-0029: the audience is people
// for whom hand-editing another program's config is a wall).

const run = promisify(execFile)

/** How long Codex's CLI may take before we stop waiting.
 *
 *  Generous because `codex.exe` is a 293 MB binary whose cold start on a slow
 *  disk is nobody's idea of prompt — and finite because the alternative is a
 *  panel row that says "Checking…" until the app is closed. */
const CLI_TIMEOUT_MS = 20_000

function listBinDirs(root: string): BinDir[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => ({ name: item.name, mtimeMs: statSync(join(root, item.name)).mtimeMs }))
  } catch {
    // No Codex install, or a directory we may not list. Either way it
    // contributes no candidates, which is the honest answer.
    return []
  }
}

function cli(): string | null {
  return findCodexCli({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    listBinDirs,
    exists: (path) => existsSync(path)
  })
}

/** This build's entry, from the live app — the same one Claude Desktop gets. */
function currentEntry(): ServerEntry {
  const { appPath } = resolveAppRoot(__dirname)
  return shimEntry({
    execPath: process.execPath,
    appPath,
    userData: app.getPath('userData'),
    defaultUserData: defaultUserDataPath()
  })
}

function status(state: ClientStatus['state'], location: string, problem?: string): ClientStatus {
  return {
    id: 'codex',
    displayName: CONNECT_CLIENT_LABELS['codex'],
    state,
    location,
    ...(problem === undefined ? {} : { problem })
  }
}

interface CliResult {
  readonly code: number
  readonly stdout: string
}

/**
 * Run Codex's CLI and report how it went.
 *
 * A NON-ZERO EXIT IS DATA, NOT A FAILURE: `mcp get` on a name Codex does not
 * know exits 1, and that is precisely how we learn we are not connected yet.
 * So the exit code is returned rather than thrown on, and only a spawn that
 * could not happen at all — the binary vanished between discovery and here, a
 * permission refusal, the timeout above — becomes a thrown error.
 *
 * `CODEX_HOME` is passed through so a user on a non-default home has their own
 * config written rather than a second one appearing in `~/.codex`. It is the
 * one thing we ever say about that directory; we never open it.
 */
async function runCodex(binary: string, args: string[]): Promise<CliResult> {
  try {
    const { stdout } = await run(binary, args, {
      timeout: CLI_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, CODEX_HOME: codexHome(process.env, homedir()) }
    })
    return { code: 0, stdout }
  } catch (err) {
    const failure = err as { code?: number | string; stdout?: string; killed?: boolean }
    if (typeof failure.code === 'number' && !failure.killed) {
      return { code: failure.code, stdout: failure.stdout ?? '' }
    }
    throw err
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function codexStatus(): Promise<ClientStatus> {
  const binary = cli()
  if (binary === null) return status('not-detected', codexBinRoot(process.env, homedir()))

  try {
    const result = await runCodex(binary, ['mcp', 'get', MCP_SERVER_KEY, '--json'])
    // Exit 1 is "no MCP server named 'carton-fit' found" — the ordinary
    // not-yet-connected case, and the reason this is not treated as an error.
    if (result.code !== 0) return status('not-connected', binary)

    const server = parseCodexGet(result.stdout)
    if (server === null) {
      // Exit 0 and an answer we cannot read means the CLI's contract moved
      // under us — ADR-0030's first revisit trigger. Loud on purpose: the
      // alternative is silently offering to re-add a server that is already
      // there, forever.
      return status(
        'error',
        binary,
        'ChatGPT’s command-line tool answered in a format Carton Fit does not recognise, ' +
          'so nothing was changed. This usually means ChatGPT updated — please report it.'
      )
    }
    if (!sameEntry(server.entry, currentEntry())) return status('outdated', binary)
    if (!server.enabled) {
      // Present, correct, and switched off in Codex's own UI. Reporting this
      // as `connected` would be a green light on a feature that cannot run,
      // and re-enabling it behind the user's back would undo a choice they
      // made deliberately. So: say so, and say where to fix it.
      return status(
        'error',
        binary,
        'Carton Fit is set up in ChatGPT but switched off. Turn it back on in ChatGPT’s ' +
          'Settings → Plugins → MCPs.'
      )
    }
    return status('connected', binary)
  } catch (err) {
    return status('error', binary, `ChatGPT’s command-line tool could not be run: ${describe(err)}`)
  }
}

/**
 * Add (or replace) our entry, then report what Codex says afterwards.
 *
 * `codex mcp add` is idempotent by name — probed against a throwaway
 * `CODEX_HOME` and recorded in ADR-0030's Context: a second add with the same
 * name replaces the entry in place, preserving comments, unrelated keys and
 * other servers byte-for-byte. That property is why this is one call and not a
 * remove-then-add, which would leave a user with no server at all if the
 * second half failed.
 */
export async function codexConnect(): Promise<ClientStatus> {
  const binary = cli()
  if (binary === null) return status('not-detected', codexBinRoot(process.env, homedir()))

  try {
    const result = await runCodex(binary, codexAddArgv(currentEntry()))
    if (result.code !== 0) {
      return status(
        'error',
        binary,
        `ChatGPT’s command-line tool refused to add Carton Fit (exit ${result.code}). ` +
          'Nothing was changed.'
      )
    }
  } catch (err) {
    return status('error', binary, `ChatGPT’s command-line tool could not be run: ${describe(err)}`)
  }
  // Read back rather than reporting success on the strength of an exit code:
  // the state the user is shown is the state Codex reports.
  return codexStatus()
}

export const codexClient: ConnectClient = {
  id: 'codex',
  displayName: CONNECT_CLIENT_LABELS['codex'],
  status: codexStatus,
  connect: codexConnect
}
