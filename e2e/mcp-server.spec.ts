import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AS1_ASSEMBLY, GOLDEN_PACKS } from '../samples/goldens'
import type { EstimateReport } from '../src/main/mcp/estimate'
import type { InspectReport } from '../src/main/mcp/inspect'
import { REPO_ROOT, SAMPLES } from './harness'

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
 *      arrangement the v2 drive tier builds on.
 *
 * Against the packaged build these specs speak to the exact bytes that ship;
 * without PACKAGED_APP they run the same out/ build through the dev Electron
 * binary, which still proves both entry modes end to end.
 */

const packaged = process.env.PACKAGED_APP

/** The dev Electron binary — the same resolution `_electron.launch()` uses. */
function electronBinary(): string {
  return createRequire(__filename)('electron') as string
}

function appVersion(): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string })
    .version
}

/** Child env for a run-as-node launch. The harness strips this variable for
 *  app launches because VSCode leaks it; here it is the mechanism itself. */
function nodeModeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/** Child env for a real app launch — the variable DELETED, not blanked:
 *  Electron tests presence, not truthiness (see e2e/harness.ts). */
function appModeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return env
}

function headlessLaunch(): { command: string; args: string[] } {
  if (packaged) {
    // The entry lives INSIDE app.asar; Node can execute it from there because
    // Electron keeps its asar fs patches on in run-as-node mode. If that ever
    // regresses, this is the spec that says so.
    return {
      command: packaged,
      args: [join(dirname(packaged), 'resources', 'app.asar', 'out', 'main', 'mcp.js')]
    }
  }
  return { command: electronBinary(), args: [join(REPO_ROOT, 'out', 'main', 'mcp.js')] }
}

function appHostedLaunch(): { command: string; args: string[] } {
  // A throwaway profile, same reason as the harness: ADR-0014 window
  // persistence made launches stateful, and this window opens for real.
  const profile = `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-mcp-'))}`
  if (packaged) return { command: packaged, args: ['--mcp-server', profile] }
  return {
    command: electronBinary(),
    args: [join(REPO_ROOT, 'out', 'main', 'index.js'), '--mcp-server', profile]
  }
}

async function connect(
  launch: { command: string; args: string[] },
  env: Record<string, string>
): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '0' })
  await client.connect(new StdioClientTransport({ ...launch, env }))
  return client
}

async function callStructured<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const text =
    Array.isArray(result.content) && result.content[0]?.type === 'text'
      ? String(result.content[0].text)
      : ''
  expect(result.isError ?? false, `${name} failed: ${text}`).toBe(false)
  return result.structuredContent as T
}

test('headless entry serves v1 over stdio under ELECTRON_RUN_AS_NODE', async () => {
  const client = await connect(headlessLaunch(), nodeModeEnv())
  try {
    // The handshake carries the build's identity (ADR-0029: one version
    // number). Headless derives it without Electron; it must equal the app's.
    expect(client.getServerVersion()).toMatchObject({
      name: 'carton-fit',
      version: appVersion()
    })

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

test('the app launched with --mcp-server serves the same protocol from main', async () => {
  const client = await connect(appHostedLaunch(), appModeEnv())
  try {
    expect(client.getServerVersion()).toMatchObject({
      name: 'carton-fit',
      version: appVersion()
    })
    // Same tools, same answer — but computed in the Electron main process with
    // a window up, which is what proves stdout stayed protocol-clean through a
    // full app boot (Chromium logs to stderr; one stray console.log here would
    // have corrupted the handshake before this line).
    const inspect = await callStructured<InspectReport>(client, 'inspect_model', {
      path: join(SAMPLES, AS1_ASSEMBLY.file)
    })
    expect(inspect.totals.parts).toBe(AS1_ASSEMBLY.partCount)
  } finally {
    await client.close()
  }
})
