import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CUBE_STL } from '../samples/goldens'
import type { AppStateReport } from '../src/main/mcp/appState'
import type { DriveOutcome } from '../src/shared/mcpDrive'
import { shimEntry } from '../src/main/connect/entry'
import { REPO_ROOT, importSample, launchApp, launchTarget } from './harness'
import {
  callStructured,
  connect,
  electronBinary,
  expectedServerVersion,
  nodeModeEnv,
  shimLaunch,
  stopSpawnedApp
} from './mcpClient'

/**
 * The `--mcp` shim and the single-instance pipe (ADR-0029, slice
 * `mcp-shim-single-instance`) — the launch-order promise, proven in BOTH
 * directions, plus the manual-second-launch routing.
 *
 * This transport is what Claude Desktop's config points at (phase 6 writes
 * exactly this invocation), and after the Windows finding it is not a
 * convenience but the mechanism: a GUI-subsystem Electron process never
 * receives stdin, so the drive tier reaches Windows only through a headless
 * proxy and a pipe. The drive-tier semantics themselves are proven in
 * mcp-drive.spec.ts / mcp-data-tools.spec.ts, which ride this same shim; what
 * is under test HERE is the shim's own reasoning — connect vs launch, one
 * instance per profile, and the app outliving or outquitting its clients
 * correctly.
 */

type Outcome = { state: AppStateReport; estimate: DriveOutcome['estimate'] }

test('the entry launches from nothing but the environment it declares', async () => {
  test.setTimeout(120_000)
  // THE REGRESSION FOR ADR-0030's ADDENDUM 3, and the test that would have
  // caught it before a dogfooder did.
  //
  // OpenAI documents that Codex hands a stdio MCP child ONLY the variables its
  // entry declares — not the user's environment. Claude Desktop inherits, so
  // for one client the entry could get away with naming a single variable, and
  // for the other the same entry produced a server that ChatGPT listed as
  // enabled and that advertised no tools at all: the app the shim spawns
  // inherits the shim's environment, cannot start without a display or a home,
  // and the shim then exits 1 having written nothing to stdout.
  //
  // So the launch below is given what `shimEntry` declares and nothing we add
  // — the client contract, executed. Mutation-tested by reverting the entry to
  // `ELECTRON_RUN_AS_NODE` alone: it then reaches the 20-second deadline and
  // returns no tools, which is the dogfooded bug exactly.
  //
  // ONE HONEST GAP: the MCP SDK's stdio transport folds a small inherited set
  // (HOME, PATH, SHELL, TERM, USER, LOGNAME) in beneath what it is given, so
  // this environment is a little more generous than Codex's. That makes the
  // test WEAKER than the real client, never stronger — it still fails without
  // the variables the entry now carries, because the missing one here is the
  // display.
  const launch = shimLaunch()
  // Only the env is taken from here; the launch itself is `shimLaunch`, which
  // the rest of this suite already drives. `appPath` feeds the args, which are
  // not used, and the profile is the one the launch already carries.
  const declared = shimEntry({
    execPath: launch.command,
    appPath: REPO_ROOT,
    userData: launch.profile,
    defaultUserData: launch.profile,
    platform: process.platform,
    env: process.env
  }).env
  expect(declared?.['ELECTRON_RUN_AS_NODE']).toBe('1')

  const client = await connect(launch, { ...declared } as Record<string, string>)
  try {
    const { tools } = await client.listTools()
    // The whole surface, not merely a handshake: a client that connects and
    // lists nothing is the exact shape of the failure this pins.
    expect(tools.length).toBeGreaterThan(1)
    expect(tools.map((tool) => tool.name)).toContain('get_app_state')
    // And it can actually be driven — which proves the app really booted
    // behind the pipe rather than the shim answering on its own.
    const state = await callStructured<{ state: AppStateReport }>(client, 'get_app_state', {})
    expect(state.state).toBeDefined()
  } finally {
    await client.close()
    await stopSpawnedApp(launch.profile)
  }
})

test('no app running: the shim boots one, hidden, and serves the full surface', async () => {
  test.setTimeout(120_000)
  const shim = shimLaunch()
  // Timed, not asserted: this is THE cold path — no app running, so the shim
  // spawns one and answers the handshake only once that app's pipe does. It is
  // the measurement ADR-0030's open detail 1 needs against Codex's 10-second
  // startup timeout, and it accumulates from here so the numbers exist on both
  // platforms by the time that detail has to close.
  const client = await connect(shim, nodeModeEnv(), 'cold connect')
  try {
    // The full surface — v1, drive, data — because a real app with a real
    // database answers, not the v1-only standalone entry.
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_preset',
      'capture_view',
      'estimate',
      'export_estimate',
      'get_app_state',
      'get_estimate',
      'inspect_model',
      'list_presets',
      'list_saved_estimates',
      'load_model',
      'restore_estimate',
      'save_estimate',
      'save_preset',
      'set_inputs',
      'set_part_weight'
    ])
    // One version through however many hops: shim, pipe, session — the same
    // stamped number the stdio transport reports (ADR-0027 on the wire).
    expect(client.getServerVersion()).toMatchObject({
      name: 'carton-fit',
      version: expectedServerVersion()
    })

    // Nothing in this session was a drive call, so the window never revealed —
    // and an app nobody can see, serving a client that is about to leave, must
    // put ITSELF away. Read the pid before closing; prove it dies after.
    const pid = Number(readFileSync(join(shim.profile, 'mcp-server.pid'), 'utf8').trim())
    expect(pid).toBeGreaterThan(0)
    await client.close()
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return 'alive'
          } catch {
            return 'gone'
          }
        },
        { timeout: 15_000 }
      )
      .toBe('gone')
  } finally {
    await client.close().catch(() => undefined)
    await stopSpawnedApp(shim.profile)
  }
})

test('app already running: the shim connects to IT — the person’s window, not a rival', async () => {
  test.setTimeout(120_000)
  // The other direction of launch order, and the one that makes the drive
  // tier trustworthy: someone opens the app, loads a part, then asks Claude.
  // The answer must describe the window they are looking at.
  const { app, page } = await launchApp()
  try {
    await importSample(page, CUBE_STL.file)
    const profile = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData')
    )

    const shim = shimLaunch(profile)
    const client = await connect(shim, nodeModeEnv())
    try {
      const result = await client.callTool({ name: 'get_app_state', arguments: {} })
      expect(result.isError ?? false).toBe(false)
      const outcome = result.structuredContent as Outcome
      // THE assertion: the file a person dropped on the window, visible to the
      // shim's client. A second spawned instance would answer { loaded: false }.
      expect(outcome.state.file).toMatchObject({ loaded: true, name: CUBE_STL.file })
    } finally {
      await client.close()
    }
    // …and the app is still the person's: connected clients coming and going
    // must not touch a window someone launched themselves.
    expect(app.process().exitCode).toBeNull()
  } finally {
    await app.close()
  }
})

test('a second manual launch shows the hidden instance’s window and exits', async () => {
  test.setTimeout(120_000)
  // The single-instance half. A person double-clicks the icon while a hidden
  // server owns their profile: they mean "show me the app". The second
  // process's whole job is to deliver that message and get out of the way —
  // lingering would mean two apps disputing one pipe and one database.
  const profile = mkdtempSync(join(tmpdir(), 'pe-second-'))
  const first = await launchApp(['--mcp-server', `--user-data-dir=${profile}`])
  try {
    expect(
      await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
    ).toBe(false)

    // A plain second launch of the same profile — the double-click, faithfully:
    // no flags, no playwright harness holding its hand.
    // launchTarget() gives playwright's launch shape: packaged, the binary is
    // executablePath; dev, args[0] is the built entry and the DEV ELECTRON is
    // the command — the same split the shim's own spawnTarget makes.
    const target = launchTarget()
    const command = target.executablePath ?? electronBinary()
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    const second = spawn(command, [...target.args, `--user-data-dir=${profile}`], {
      env,
      stdio: 'ignore'
    })
    const secondExited = new Promise<number | null>((resolve) =>
      second.once('exit', (code) => resolve(code))
    )

    // The FIRST instance's window comes out of hiding…
    await expect
      .poll(
        () =>
          first.app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
          ),
        { timeout: 15_000 }
      )
      .toBe(true)
    // …and the second process is gone, not minimized, not hidden — gone.
    await secondExited
  } finally {
    await first.app.close()
  }
})
