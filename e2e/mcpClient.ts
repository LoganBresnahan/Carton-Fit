import { expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { REPO_ROOT, SOFTWARE_GL } from './harness'

// Shared MCP-over-stdio launch plumbing for the server specs (ADR-0029). Two
// launch modes exist and both must work against the packaged bytes and the
// out/ build — the mode-specific reasoning lives with each helper.

const packaged = process.env.PACKAGED_APP

/** The dev Electron binary — the same resolution `_electron.launch()` uses. */
function electronBinary(): string {
  return createRequire(__filename)('electron') as string
}

export function appVersion(): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string })
    .version
}

/** Child env for a run-as-node launch. The harness strips this variable for
 *  app launches because VSCode leaks it; here it is the mechanism itself. */
export function nodeModeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/** Child env for a real app launch — the variable DELETED, not blanked:
 *  Electron tests presence, not truthiness (see e2e/harness.ts). */
export function appModeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return env
}

export function headlessLaunch(): { command: string; args: string[] } {
  if (packaged) {
    // The entry lives INSIDE app.asar; Node can execute it from there because
    // Electron keeps its asar fs patches on in run-as-node mode. If that ever
    // regresses, the headless specs are what say so.
    return {
      command: packaged,
      args: [join(dirname(packaged), 'resources', 'app.asar', 'out', 'main', 'mcp.js')]
    }
  }
  return { command: electronBinary(), args: [join(REPO_ROOT, 'out', 'main', 'mcp.js')] }
}

export function appHostedLaunch(): { command: string; args: string[] } {
  // A throwaway profile, same reason as the harness: ADR-0014 window
  // persistence made launches stateful, and this window opens for real. The
  // GL flags are here because capture_view renders a real WebGL scene.
  const extras = [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'pe-mcp-'))}`, ...SOFTWARE_GL]
  if (packaged) return { command: packaged, args: ['--mcp-server', ...extras] }
  return {
    command: electronBinary(),
    args: [join(REPO_ROOT, 'out', 'main', 'index.js'), '--mcp-server', ...extras]
  }
}

export async function connect(
  launch: { command: string; args: string[] },
  env: Record<string, string>
): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '0' })
  await client.connect(new StdioClientTransport({ ...launch, env }))
  return client
}

export async function callStructured<T>(
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
