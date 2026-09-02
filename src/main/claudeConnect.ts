import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { CLAUDE_CONNECT_CHANNELS, type ClaudeConnectStatus } from '../shared/claudeConnect'
import {
  claudeConfigDir,
  claudeConfigPath,
  mergeEntry,
  readConfig,
  sameEntry,
  shimEntry,
  type ServerEntry
} from './claudeConfig'
import { resolveAppRoot } from './mcp/host'
import { defaultUserDataPath } from './mcp/pipePath'

// "Connect to Claude" (ADR-0029, slice `connect-to-claude-button`) — the half
// that touches the disk and the IPC boundary. The path rules, the entry, and
// the merge itself live in `claudeConfig.ts`, Electron-free so they unit-test.
//
// Rules 1 and 2 from that file govern here too, and the enforcement is here:
// a refusal to parse becomes a refusal to write, and every write lands through
// a temp file and a rename.

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

function problemStatus(configPath: string, problem: string): ClaudeConnectStatus {
  return { state: 'error', configPath, problem }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Look, change nothing. */
export function claudeStatus(): ClaudeConnectStatus {
  const configPath = claudeConfigPath()
  if (!existsSync(claudeConfigDir())) return { state: 'claude-not-found', configPath }
  try {
    const read = readConfig(readConfigFile(configPath))
    if (!read.ok) return problemStatus(configPath, read.problem)
    if (read.entry === null) return { state: 'not-connected', configPath }
    return {
      state: sameEntry(read.entry, currentEntry()) ? 'connected' : 'outdated',
      configPath
    }
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
export function claudeConnect(): ClaudeConnectStatus {
  const configPath = claudeConfigPath()
  const dir = claudeConfigDir()
  if (!existsSync(dir)) return { state: 'claude-not-found', configPath }

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

export function registerClaudeConnectIpc(): void {
  ipcMain.handle(CLAUDE_CONNECT_CHANNELS.status, (): ClaudeConnectStatus => claudeStatus())
  ipcMain.handle(CLAUDE_CONNECT_CHANNELS.connect, (): ClaudeConnectStatus => claudeConnect())
}
