import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONNECT_CLIENT_LABELS, type ClientStatus } from '../shared/connect'
import {
  chooseConfigDir,
  claudeConfigCandidates,
  claudeConfigFile,
  mergeEntry,
  readConfig,
  sameEntry,
  shimEntry,
  type ChosenConfigDir,
  type ServerEntry
} from './claudeConfig'
import { resolveAppRoot } from './mcp/host'
import { defaultUserDataPath } from './mcp/pipePath'

// The Claude Desktop client (ADR-0029, slice `connect-to-claude-button`) — the
// half that touches the disk. The path rules, the entry, and the merge itself
// live in `claudeConfig.ts`, Electron-free so they unit-test.
//
// Rules 1 and 2 from that file govern here too, and the enforcement is here:
// a refusal to parse becomes a refusal to write, and every write lands through
// a temp file and a rename.
//
// It no longer owns an IPC channel: ADR-0030 made it one client of a registry
// (`connect/index.ts`), which is what registers and calls the two functions
// below. What changed here is only the shape they answer in — a `ClientStatus`
// naming which client it describes, since a panel of rows must be able to tell
// them apart. Read-write-refuse is untouched.

/**
 * The `Claude_*` package folders under `%LOCALAPPDATA%\\Packages` — the Store
 * build's virtualized home (see `claudeConfigCandidates`).
 *
 * Best-effort and win32-only: no Packages directory, or one we may not list,
 * simply contributes no candidates and the classic path still answers. The
 * prefix match is deliberate — the folder is `Claude_<publisher hash>`, and
 * the hash is not ours to hardcode.
 */
function msixPackageNames(): string[] {
  if (process.platform !== 'win32') return []
  const root = join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Packages')
  try {
    return readdirSync(root).filter((name) => name.startsWith('Claude_'))
  } catch {
    return []
  }
}

/** Which config directory this machine actually has, and whether it has one. */
function resolveDir(): ChosenConfigDir {
  return chooseConfigDir(
    claudeConfigCandidates(process.platform, process.env, homedir(), msixPackageNames()),
    (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    },
    (path) => existsSync(path)
  )
}

/** Read the file, or null when it is not there. Any other read failure throws
 *  — a permission error must not masquerade as "no config yet" and get
 *  answered by a write that then fails differently. */
function readConfigFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** This build's entry, from the live app. */
function currentEntry(): ServerEntry {
  const { appPath } = resolveAppRoot(__dirname)
  return shimEntry({
    execPath: process.execPath,
    appPath,
    userData: app.getPath('userData'),
    defaultUserData: defaultUserDataPath()
  })
}

/** Every status this client returns, in the shared shape. */
function status(
  state: ClientStatus['state'],
  configPath: string,
  problem?: string
): ClientStatus {
  return {
    id: 'claude-desktop',
    displayName: CONNECT_CLIENT_LABELS['claude-desktop'],
    state,
    location: configPath,
    ...(problem === undefined ? {} : { problem })
  }
}

function problemStatus(configPath: string, problem: string): ClientStatus {
  return status('error', configPath, problem)
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Look, change nothing. */
export function claudeStatus(): ClientStatus {
  const chosen = resolveDir()
  const configPath = claudeConfigFile(chosen.dir)
  if (!chosen.found) return status('not-detected', configPath)
  try {
    const read = readConfig(readConfigFile(configPath))
    if (!read.ok) return problemStatus(configPath, read.problem)
    if (read.entry === null) return status('not-connected', configPath)
    return status(sameEntry(read.entry, currentEntry()) ? 'connected' : 'outdated', configPath)
  } catch (err) {
    return problemStatus(configPath, `Claude Desktop’s config could not be read: ${describe(err)}`)
  }
}

/**
 * Write this build's entry and report what the file says afterwards.
 *
 * Written to a sibling temp file and renamed, because the alternative failure —
 * a truncated write over a config holding other people's servers — is exactly
 * the loss rule 1 exists to prevent, and it is not recoverable by trying again.
 * `renameSync` replaces an existing file on every platform we ship.
 */
export function claudeConnect(): ClientStatus {
  const chosen = resolveDir()
  const configPath = claudeConfigFile(chosen.dir)
  if (!chosen.found) return status('not-detected', configPath)

  const temp = `${configPath}.carton-fit.tmp`
  try {
    const read = readConfig(readConfigFile(configPath))
    if (!read.ok) return problemStatus(configPath, read.problem)
    writeFileSync(temp, mergeEntry(read.config, currentEntry()), 'utf8')
    renameSync(temp, configPath)
  } catch (err) {
    try {
      unlinkSync(temp)
    } catch {
      // Never created, or already gone — either way the config is untouched.
    }
    return problemStatus(configPath, `Claude Desktop’s config could not be written: ${describe(err)}`)
  }
  // Read back rather than returning 'connected' on the strength of a write that
  // did not throw: the state the user is shown is the state of the file.
  return claudeStatus()
}

