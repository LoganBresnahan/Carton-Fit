import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { AS1_ASSEMBLY, GOLDEN_PACKS } from '../samples/goldens'
import type { EstimateReport } from '../src/main/mcp/estimate'
import type { InspectReport } from '../src/main/mcp/inspect'
import { SAMPLES } from './harness'
import {
  appHostedLaunch,
  appModeEnv,
  expectedServerVersion,
  callStructured,
  connect,
  headlessLaunch,
  nodeModeEnv
} from './mcpClient'

/**
 * The MCP server host, driven the way Claude Desktop drives it (ADR-0029,
 * slice `mcp-server-host-in-main`).
 *
 * The tools' answers are already pinned by tests/mcp-goldens.test.ts over the
 * in-memory transport; what is under test HERE is hosting — the two launch
 * modes that exist only outside a unit test:
 *
 *   1. HEADLESS: the shipped binary running out/main/mcp.js as plain Node via
 *      ELECTRON_RUN_AS_NODE. Everything about this mode is the packaged-only
 *      failure class ADR-0005 exists for: module resolution from inside
 *      app.asar, the asarUnpacked wasm found without Electron's help, a
 *      version read without `app.getVersion()`.
 *   2. APP-HOSTED: the real app launched with --mcp-server, serving the same
 *      protocol from the Electron main process beside a live window — the
 *      arrangement the v2 drive tier builds on (see mcp-drive.spec.ts).
 *
 * Against the packaged build these specs speak to the exact bytes that ship;
 * without PACKAGED_APP they run the same out/ build through the dev Electron
 * binary, which still proves both entry modes end to end.
 */

test('headless entry serves v1 over stdio under ELECTRON_RUN_AS_NODE', async () => {
  const client = await connect(headlessLaunch(), nodeModeEnv())
  try {
    // The handshake carries the build's identity (ADR-0029: one version
    // number). Headless derives it without Electron; it must equal the app's —
    // and it carries the `+sha` suffix whenever this build is not its own
    // release, so a dogfooding build cannot introduce itself as the release
    // whose number package.json is still holding (ADR-0027).
    expect(client.getServerVersion()).toMatchObject({
      name: 'carton-fit',
      version: expectedServerVersion()
    })

    // v1 only, and deliberately so: the drive tools need a running app, and a
    // tool that shrugs is worse than absence (ADR-0029).
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['estimate', 'inspect_model'])

    // One golden through the wasm path — the risky half of this mode: the
    // asarUnpacked binary must be found from a process Electron never set up.
    const inspect = await callStructured<InspectReport>(client, 'inspect_model', {
      path: join(SAMPLES, AS1_ASSEMBLY.file)
    })
    expect(inspect.totals.parts).toBe(AS1_ASSEMBLY.partCount)
    expect(inspect.totals.triangles).toBe(AS1_ASSEMBLY.triangleCount)
  } finally {
    await client.close()
  }
})

test('headless estimate matches the hand-computed golden', async () => {
  const golden = GOLDEN_PACKS.find((pack) => pack.name === 'cube max-quantity in a 12 in carton')
  if (!golden?.count) throw new Error('golden scenario missing')

  const client = await connect(headlessLaunch(), nodeModeEnv())
  try {
    const report = await callStructured<EstimateReport>(client, 'estimate', {
      path: join(SAMPLES, golden.part.file),
      mode: golden.mode,
      tier: golden.tier,
      carton: {
        dimensions: {
          x: golden.cartonIn[0],
          y: golden.cartonIn[1],
          z: golden.cartonIn[2],
          unit: 'in'
        },
        measured: 'inner'
      }
    })
    expect(report.outcome).toMatchObject({ mode: 'max-quantity', count: golden.count })
    expect(report.binding.constraint).toBe('geometry')
  } finally {
    await client.close()
  }
})

test('the app launched with --mcp-server serves the full surface from main', async () => {
  // The GUI process never receives stdin on Windows (ADR-0029's Windows
  // finding, pinned by the probe run: stdout markers flowed, the initialize
  // never arrived), so THIS transport cannot exist there — the drive tier
  // reaches Windows through the --mcp shim instead (mcp-shim.spec.ts). On
  // Linux the stdio mode remains real and stays proven here.
  test.skip(process.platform === 'win32', 'GUI-subsystem Electron never receives stdin on Windows')
  const client = await connect(appHostedLaunch(), appModeEnv())
  try {
    expect(client.getServerVersion()).toMatchObject({
      name: 'carton-fit',
      version: expectedServerVersion()
    })
    // The whole surface: v1, plus the drive and data tiers the running app
    // makes possible. The headless entry above publishes two; this publishes
    // fifteen, and the difference is exactly "there is a window and a database
    // here".
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
    // Same v1 answer — computed in the Electron main process with a window up,
    // which is what proves stdout stayed protocol-clean through a full app
    // boot (Chromium logs to stderr; one stray console.log in main would have
    // corrupted the handshake before this line).
    const inspect = await callStructured<InspectReport>(client, 'inspect_model', {
      path: join(SAMPLES, AS1_ASSEMBLY.file)
    })
    expect(inspect.totals.parts).toBe(AS1_ASSEMBLY.partCount)
  } finally {
    await client.close()
  }
})
