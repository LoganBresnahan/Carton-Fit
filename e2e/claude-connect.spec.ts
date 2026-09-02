import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CUBE_STL } from '../samples/goldens'
import type { AppStateReport } from '../src/main/mcp/appState'
import { CLAUDE_SERVER_KEY } from '../src/shared/claudeConnect'
import { importSample, launchApp, type AppHandle } from './harness'
import { appModeEnv, callStructured, connect, stopSpawnedApp } from './mcpClient'

/**
 * "Connect to Claude" (ADR-0029, slice `connect-to-claude-button`) — the last
 * slice, and the one whose failure mode is entirely outside this app.
 *
 * A button that writes JSON is trivial to assert and worthless to assert that
 * way: a spec comparing the written entry to a constant would pass just as
 * happily if the entry named the wrong binary, forgot `ELECTRON_RUN_AS_NODE`,
 * or omitted the profile flag — and every one of those reaches the user as
 * "Claude Desktop doesn't see Carton Fit", with nothing in any log. So the
 * first test here does not check what was written. It RUNS it: spawns exactly
 * the command the button put in the config, speaks MCP down it, and asks the
 * app what file is open. What comes back is the part imported through the UI
 * two paragraphs earlier — which is the whole feature, end to end.
 *
 * Claude Desktop is never touched. `CLAUDE_DESKTOP_CONFIG_DIR` points main at
 * a temp directory, the same seam ADR-0021 gives the update check, and a
 * dogfooder's real config is never opened by a test run.
 */

interface ConfigFile {
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>
  [key: string]: unknown
}

function claudeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pe-claude-'))
}

function configPath(dir: string): string {
  return join(dir, 'claude_desktop_config.json')
}

/**
 * Launch with main pointed at a fake Claude Desktop config directory.
 *
 * Set-then-delete around the launch, exactly like `update-check.spec.ts`: the
 * harness copies `process.env` into the child, and leaving these set would
 * silently reconfigure every later spec in this worker.
 */
async function launchWith(dir: string, profile: string): Promise<AppHandle> {
  process.env.CLAUDE_DESKTOP_CONFIG_DIR = dir
  try {
    return await launchApp([`--user-data-dir=${profile}`])
  } finally {
    delete process.env.CLAUDE_DESKTOP_CONFIG_DIR
  }
}

test('the button writes an invocation that actually reaches this window', async () => {
  test.setTimeout(180_000)
  const dir = claudeDir()
  const profile = mkdtempSync(join(tmpdir(), 'pe-claude-profile-'))

  // A config that is already somebody's: another server, and a top-level key
  // that has nothing to do with us. Both must survive — rule 1 of
  // src/main/claudeConfig.ts, which is a promise about other people's work.
  const existing = {
    globalShortcut: 'Alt+Space',
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
    }
  }
  writeFileSync(configPath(dir), `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

  let app = await launchWith(dir, profile)
  try {
    // Something to read back later. This is what makes the MCP round-trip
    // below an assertion about THIS window rather than about any app.
    await importSample(app.page, CUBE_STL.file)

    await app.page.click('[data-testid="claude-connect"]')
    await app.page.waitForSelector('[data-testid="claude-connected"]')
    // The restart line is the feature, not a footnote: Claude Desktop reads
    // its config at startup, so a correct write connects nothing until it is
    // restarted, and without this sentence success looks like failure.
    await expect(app.page.locator('[data-testid="claude-connected"]')).toContainText('Restart')

    const written = JSON.parse(readFileSync(configPath(dir), 'utf8')) as ConfigFile
    expect(written['globalShortcut']).toBe('Alt+Space')
    expect(written.mcpServers?.['filesystem']).toEqual(existing.mcpServers.filesystem)

    const entry = written.mcpServers?.[CLAUDE_SERVER_KEY]
    expect(entry, 'no carton-fit entry was written').toBeDefined()
    if (entry === undefined) return

    // ASSERTED, NOT INFERRED, and stated here because mutation testing showed
    // the round-trip below does NOT cover it: deleting `env` from the entry
    // still passes on Linux, where an Electron process's stdio works either
    // way. The variable is a WINDOWS requirement (ADR-0029's finding: a
    // GUI-subsystem process never receives stdin), so on this machine only an
    // explicit check — and tests/claude-connect.test.ts's — can carry it.
    expect(entry.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })

    // RUN WHAT WAS WRITTEN. The child's environment starts WITHOUT
    // ELECTRON_RUN_AS_NODE (appModeEnv deletes it) and gets only what the
    // config's own `env` supplies, so the spawn below is the entry's own
    // doing. Mutation-tested where it does bite: dropping the profile flag
    // sends the shim to the default profile, which has no app listening — it
    // boots a fresh empty one and `loaded: true` fails.
    const client = await connect(
      { command: entry.command, args: entry.args },
      { ...appModeEnv(), ...(entry.env ?? {}) }
    )
    try {
      // The app is already running on this profile, so the shim CONNECTS
      // rather than spawning — the launch-order direction a real user hits
      // when they set this up with the app open in front of them.
      const state = await callStructured<{ state: AppStateReport }>(client, 'get_app_state', {})
      expect(state.state.file).toMatchObject({ loaded: true, name: CUBE_STL.file })
    } finally {
      await client.close()
    }
  } finally {
    await app.app.close()
    await stopSpawnedApp(profile)
  }

  // A relaunch must RECOGNISE what the last one wrote — otherwise the panel
  // offers to connect an app that is already connected, and the entry-matching
  // half of the feature is untested.
  app = await launchWith(dir, profile)
  try {
    await app.page.waitForSelector('[data-testid="claude-connected"]')
    await expect(app.page.locator('[data-testid="claude-connect"]')).toHaveText('Reconnect')
  } finally {
    await app.app.close()
  }
})

test('a config we cannot parse is refused, loudly, and left byte-for-byte alone', async () => {
  test.setTimeout(120_000)
  const dir = claudeDir()
  const profile = mkdtempSync(join(tmpdir(), 'pe-claude-profile-'))

  // The file this protects: unparseable to us, and quite possibly full of
  // servers the user spent an afternoon configuring. "Start fresh" would
  // delete every one of them to add ours.
  const damaged = '{ "mcpServers": { "filesystem": { command: npx } }\n'
  writeFileSync(configPath(dir), damaged, 'utf8')

  const app = await launchWith(dir, profile)
  try {
    await app.page.click('[data-testid="claude-connect"]')
    const error = app.page.locator('[data-testid="claude-error"]')
    await error.waitFor()
    // Loud AND specific: it names the file, because the user's next move is to
    // go and look at it (build-plan sequencing risk 5).
    await expect(error).toContainText('not valid JSON')
    await expect(error).toContainText('claude_desktop_config.json')
    expect(readFileSync(configPath(dir), 'utf8')).toBe(damaged)
  } finally {
    await app.app.close()
  }
})

test('no Claude Desktop: the panel says so and writes nothing', async () => {
  test.setTimeout(120_000)
  // A directory that does not exist — which is what an uninstalled Claude
  // Desktop looks like. Creating it would leave a config directory for a
  // program that is not here, under a name its owner never chose.
  const dir = join(tmpdir(), `pe-claude-absent-${Date.now()}`)
  const profile = mkdtempSync(join(tmpdir(), 'pe-claude-profile-'))

  const app = await launchWith(dir, profile)
  try {
    await app.page.waitForSelector('[data-testid="claude-not-found"]')
    // No button to press: nothing would enable it, and an offer that cannot
    // work is worse than a sentence explaining why.
    await expect(app.page.locator('[data-testid="claude-connect"]')).toHaveCount(0)
    expect(existsSync(dir)).toBe(false)
  } finally {
    await app.app.close()
  }
})
