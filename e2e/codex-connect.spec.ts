import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CUBE_STL } from '../samples/goldens'
import type { AppStateReport } from '../src/main/mcp/appState'
import { MCP_SERVER_KEY } from '../src/shared/connect'
import { REPO_ROOT, importSample, launchApp, type AppHandle } from './harness'
import { appModeEnv, callStructured, connect, stopSpawnedApp } from './mcpClient'

/**
 * "Connect to ChatGPT (Codex)" against a fake CLI (ADR-0030 Decision 7, slice
 * `fake-codex-cli-e2e`).
 *
 * The Codex adapter never opens a config file. It builds an argument vector,
 * spawns another company's program with it, and believes what comes back — so
 * what these specs drive is a stand-in `codex` at the `CODEX_CLI` seam
 * (`e2e/fake-codex/codex.js`), implementing the `mcp add/get/list/remove`
 * contract exactly as recorded in ADR-0030's Context from `codex-cli 0.152.1`.
 *
 * WHAT THAT GREEN MEANS, AND WHAT IT DOES NOT. It covers our half completely:
 * the argv `codexAddArgv` builds, the `--json` shape `parseCodexGet` accepts and
 * refuses, and the panel states that follow. It says nothing about whether the
 * recorded contract still matches OpenAI's tool — a fake cannot notice the real
 * program changing. That fidelity is delegated, on purpose and in the ADR, to
 * `codex-real-cli.spec.ts` (which runs only where a real `codex` exists — today
 * no CI runner) and to dogfooding on the requesting machine.
 *
 * NOT ON WINDOWS, and this is a correction to the build plan rather than a
 * shortcut. The plan asked for a `.cmd` shim so the fake could be launched the
 * way discovery launches `codex.exe`. It cannot be: since the fix for
 * CVE-2024-27980 (Node 18.20.2 / 20.12.2), spawning a `.bat` or `.cmd` without
 * `shell: true` throws `EINVAL`, and the adapter spawns via `execFile` with no
 * shell — correctly, because the real target is an `.exe`. The alternatives were
 * a `shell: true` in production code that exists only for a test, or a
 * Windows-only `node.exe`-plus-`NODE_OPTIONS` trick we could neither run nor
 * verify from here. Both are worse than the honest skip: everything this file
 * asserts is platform-independent (argv assembly, JSON parsing, state mapping),
 * the platform-specific half is Codex DISCOVERY, which is unit-tested for every
 * Windows shape in `tests/connect-codex-cli.test.ts`, and ADR-0030 Consequence 4 already
 * states that Codex on Windows is verified by dogfooding.
 *
 * `~/.codex` is never touched: `CODEX_HOME` points at a temp directory, and the
 * fake refuses outright to run without it.
 */

test.skip(process.platform === 'win32', 'the fake CLI is a shebang script; see the header')

const FAKE_CLI = join(REPO_ROOT, 'e2e', 'fake-codex', 'codex.js')

/** One entry in the fake's store — `$CODEX_HOME/servers.json`, standing in for
 *  the `config.toml` this app deliberately owns no parser for. */
interface FakeServer {
  command: string
  args: string[]
  env?: Record<string, string>
  enabled?: boolean
  /** The argv the ADAPTER passed to `add`, recorded by the fake so a spec can
   *  assert what was built rather than what a spec re-derived. */
  rawArgv?: string[]
  /** Seeded by a spec only: printed verbatim by `get --json`. */
  garbled?: string
}

function codexHome(): string {
  return mkdtempSync(join(tmpdir(), 'pe-codex-'))
}

function storePath(home: string): string {
  return join(home, 'servers.json')
}

function readStore(home: string): Record<string, FakeServer> {
  return JSON.parse(readFileSync(storePath(home), 'utf8')) as Record<string, FakeServer>
}

function writeStore(home: string, servers: Record<string, FakeServer>): void {
  writeFileSync(storePath(home), `${JSON.stringify(servers, null, 2)}\n`, 'utf8')
}

/**
 * Launch with main pointed at the fake CLI and a throwaway Codex home.
 *
 * Set-then-delete around the launch — the harness copies `process.env` into the
 * child, so a variable left set here would silently reconfigure every later
 * spec in this worker (build-plan sequencing risk 4). `addExit` is the fake's
 * one env knob and leaks the same way, so it is cleared on the same path.
 */
async function launchWith(
  home: string,
  profile: string,
  options: { addExit?: number } = {}
): Promise<AppHandle> {
  process.env.CODEX_CLI = FAKE_CLI
  process.env.CODEX_HOME = home
  if (options.addExit !== undefined) process.env.FAKE_CODEX_ADD_EXIT = String(options.addExit)
  try {
    return await launchApp([`--user-data-dir=${profile}`])
  } finally {
    delete process.env.CODEX_CLI
    delete process.env.CODEX_HOME
    delete process.env.FAKE_CODEX_ADD_EXIT
  }
}

test('the button runs Codex’s own CLI, and what it stored actually reaches this window', async () => {
  test.setTimeout(180_000)
  const home = codexHome()
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-profile-'))

  // A store that is already somebody's. `codex mcp add` was probed against a
  // seeded home and left every unrelated server byte-for-byte alone; a client
  // adapter that took that away from a user would be a worse bug than never
  // connecting at all.
  writeStore(home, {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
  })

  let app = await launchWith(home, profile)
  try {
    // Something to read back through the round trip below, so it is an
    // assertion about THIS window rather than about any app.
    await importSample(app.page, CUBE_STL.file)

    await app.page.waitForSelector('[data-testid="connect-codex-not-connected"]')
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')
    // The restart line is the feature, not a footnote: Codex reads its config
    // at startup, so a correct write connects nothing until the desktop app is
    // restarted — and `codex mcp list` will already show the entry, which is
    // exactly the confusing case this sentence prevents (ADR-0030 Decision 6).
    await expect(app.page.locator('[data-testid="connect-codex-connected"]')).toContainText(
      'Restart'
    )

    const store = readStore(home)
    expect(store['filesystem']).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem']
    })

    const entry = store[MCP_SERVER_KEY]
    expect(entry, 'no carton-fit entry was added').toBeDefined()
    if (entry === undefined) return

    // THE ARGV THE ADAPTER BUILT, recorded by the fake as it arrived — not a
    // constant this spec composed from the same helper under test. The `--` is
    // load-bearing and asserted by position: without it our own `--mcp` and
    // `--user-data-dir=` are Codex's flags to parse rather than the server's.
    expect(entry.rawArgv?.slice(0, 6)).toEqual([
      'mcp',
      'add',
      MCP_SERVER_KEY,
      '--env',
      'ELECTRON_RUN_AS_NODE=1',
      '--'
    ])
    expect(entry.rawArgv?.slice(6)).toEqual([entry.command, ...entry.args])

    // ASSERTED, NOT INFERRED, for the same reason as the Claude spec: the
    // round trip below still passes on Linux without `ELECTRON_RUN_AS_NODE`,
    // because stdio works either way here. It is a WINDOWS requirement
    // (ADR-0029: a GUI-subsystem Electron process never receives its stdin),
    // and on this machine only an explicit check can carry it.
    expect(entry.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    expect(entry.args).toContain('--mcp')
    expect(entry.args).toContain(`--user-data-dir=${profile}`)

    // RUN WHAT WAS STORED. A spec that only compared strings would pass just as
    // happily if the entry named the wrong binary or lost the profile flag —
    // and every one of those reaches the user as "ChatGPT doesn't see Carton
    // Fit", with nothing in any log.
    const client = await connect(
      { command: entry.command, args: entry.args },
      { ...appModeEnv(), ...(entry.env ?? {}) }
    )
    try {
      const state = await callStructured<{ state: AppStateReport }>(client, 'get_app_state', {})
      expect(state.state.file).toMatchObject({ loaded: true, name: CUBE_STL.file })
    } finally {
      await client.close()
    }

    // IDEMPOTENT BY NAME — the probed property that lets `connect()` be one
    // `add` rather than a remove-then-add, which would leave a user with no
    // server at all if the second half failed.
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')
    expect(Object.keys(readStore(home)).sort()).toEqual(['filesystem', MCP_SERVER_KEY].sort())
  } finally {
    await app.app.close()
    await stopSpawnedApp(profile)
  }

  // A relaunch must RECOGNISE what the last one wrote — otherwise the panel
  // offers to connect an app that is already connected, and the entry-matching
  // half of the feature is untested.
  app = await launchWith(home, profile)
  try {
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')
    await expect(app.page.locator('[data-testid="connect-codex-connect"]')).toHaveText('Reconnect')
  } finally {
    await app.app.close()
  }
})

test('an entry naming a different copy of the app is offered as a reconnect', async () => {
  test.setTimeout(120_000)
  const home = codexHome()
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-profile-'))

  // Our key, somebody else's binary — what an app that MOVED looks like (a
  // reinstall, a different checkout, a drive letter that changed). Reporting it
  // as connected leaves a user staring at a working button and a ChatGPT that
  // reaches a path with nothing at it.
  writeStore(home, {
    [MCP_SERVER_KEY]: { command: '/gone/carton-fit', args: ['/gone/mcp.js'], enabled: true }
  })

  const app = await launchWith(home, profile)
  try {
    await app.page.waitForSelector('[data-testid="connect-codex-outdated"]')
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')

    // REPLACED, not accumulated: one key, and it no longer names the ghost.
    const store = readStore(home)
    expect(Object.keys(store)).toEqual([MCP_SERVER_KEY])
    expect(store[MCP_SERVER_KEY]?.command).not.toBe('/gone/carton-fit')
  } finally {
    await app.app.close()
  }
})

test('a server switched off in Codex is reported, not silently switched back on', async () => {
  test.setTimeout(180_000)
  const home = codexHome()
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-profile-'))

  // Connect first, so the entry under test is this build's real one rather than
  // a hand-written approximation — `enabled` is the ONLY difference from a
  // state that would otherwise read `connected`.
  let app = await launchWith(home, profile)
  try {
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')
  } finally {
    await app.app.close()
  }

  const store = readStore(home)
  const entry = store[MCP_SERVER_KEY]
  expect(entry).toBeDefined()
  if (entry === undefined) return
  entry.enabled = false
  writeStore(home, store)

  app = await launchWith(home, profile)
  try {
    // Present, correct, and switched off in Codex's own UI. Green here would be
    // a working light on a feature that cannot run; re-enabling it behind the
    // user's back would undo a choice they made deliberately.
    const error = app.page.locator('[data-testid="connect-codex-error"]')
    await error.waitFor()
    await expect(error).toContainText('switched off')
    expect(readStore(home)[MCP_SERVER_KEY]?.enabled).toBe(false)
  } finally {
    await app.app.close()
  }
})

test('a CLI that refuses to add says so, and claims nothing was written', async () => {
  test.setTimeout(120_000)
  const home = codexHome()
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-profile-'))
  writeStore(home, {})

  const app = await launchWith(home, profile, { addExit: 1 })
  try {
    await app.page.click('[data-testid="connect-codex-connect"]')
    const error = app.page.locator('[data-testid="connect-codex-error"]')
    await error.waitFor()
    await expect(error).toContainText('refused to add')
    // And the sentence is true: a failed `add` is a `add` that wrote nothing,
    // which is why the message may promise it.
    expect(readStore(home)[MCP_SERVER_KEY]).toBeUndefined()
  } finally {
    await app.app.close()
  }
})

test('an answer we cannot read is an error, not a silent offer to re-add forever', async () => {
  test.setTimeout(120_000)
  const home = codexHome()
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-profile-'))

  // Exit 0 and a shape `parseCodexGet` refuses — ADR-0030's first revisit
  // trigger, standing in for a future CLI whose `--json` moved. Treating this
  // as not-connected would offer to re-add a server that is already there,
  // forever, and never say why.
  writeStore(home, {
    [MCP_SERVER_KEY]: {
      command: 'ignored',
      args: [],
      garbled: '{ "servers": [ { "cmd": "carton-fit" } ] }\n'
    }
  })

  const app = await launchWith(home, profile)
  try {
    const error = app.page.locator('[data-testid="connect-codex-error"]')
    await error.waitFor()
    await expect(error).toContainText('does not recognise')
    await expect(error).toContainText(FAKE_CLI)
  } finally {
    await app.app.close()
  }
})
