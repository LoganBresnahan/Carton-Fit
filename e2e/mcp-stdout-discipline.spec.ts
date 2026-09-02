import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { appHostedLaunch, appModeEnv, headlessLaunch, nodeModeEnv } from './mcpClient'

/**
 * STDOUT CARRIES THE PROTOCOL AND NOTHING ELSE (ADR-0029, slice
 * `stdout-protocol-discipline`).
 *
 * `tests/mcp-stdout.test.ts` proves the diversion mechanism against fake
 * streams. This proves the PROPERTY against a real launched server — which is
 * the only place it can be proven, because what pollutes stdout is exactly the
 * code a unit test does not run: Electron's own startup, the packaged app's
 * boot path, whatever a platform decides to print.
 *
 * It exists because the first Windows CI run of the MCP specs (33582003764,
 * 33584136244) failed every app-hosted call with `Unexpected end of JSON
 * input` — the client's parser choking on something that was not a frame. A
 * timeout says only "no answer"; this says WHAT arrived instead, because the
 * failure message carries the offending bytes escaped.
 *
 * Deliberately not using the SDK client: the client's job is to parse this
 * stream, so it can only report that parsing failed. Reading the raw pipe is
 * what turns that into evidence.
 */

const INITIALIZE =
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stdout-probe', version: '0' }
    }
  }) + '\n'

/** Everything the server put on stdout in response to one initialize. */
async function rawStdout(
  launch: { command: string; args: string[] },
  env: Record<string, string>
): Promise<{ out: string; err: string }> {
  const child = spawn(launch.command, launch.args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
  child.stdin.write(INITIALIZE)

  // Long enough for a packaged app to boot, open a window and answer; the
  // handshake itself is immediate once it does.
  await new Promise((resolve) => setTimeout(resolve, 20_000))
  child.kill()
  return { out, err }
}

/** Turn a stream into something a CI log can show without lying about it. */
function visible(text: string): string {
  return JSON.stringify(text.length > 4000 ? `${text.slice(0, 4000)}…` : text)
}

function expectProtocolOnly(out: string, err: string): void {
  // Frames are newline-delimited JSON. EVERY line has to be one — including
  // empty ones, which are the specific failure seen on Windows: an empty
  // segment means a stray newline reached the stream, and `JSON.parse('')` is
  // precisely "Unexpected end of JSON input".
  const lines = out.split('\n')
  // The last element after a trailing newline is the empty remainder, not a line.
  if (lines[lines.length - 1] === '') lines.pop()

  expect(lines.length, `nothing arrived on stdout at all. stderr was: ${visible(err)}`).toBeGreaterThan(0)

  for (const [index, line] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(
        `stdout line ${index} is not a protocol frame — something else wrote to the ` +
          `protocol stream.\n` +
          `  line:   ${visible(line)}\n` +
          `  parser: ${(error as Error).message}\n` +
          `  whole stdout: ${visible(out)}\n` +
          `  stderr:       ${visible(err)}`
      )
    }
    expect(parsed, `stdout line ${index} parsed but is not JSON-RPC`).toMatchObject({
      jsonrpc: '2.0'
    })
  }
}

test('the headless entry puts only protocol frames on stdout', async () => {
  test.setTimeout(60_000)
  const { out, err } = await rawStdout(headlessLaunch(), nodeModeEnv())
  expectProtocolOnly(out, err)
})

test('the app-hosted server puts only protocol frames on stdout', async () => {
  test.setTimeout(60_000)
  // The one that fails on Windows. A whole Electron app boots behind this
  // stream — the hard case the slice exists for.
  const { out, err } = await rawStdout(appHostedLaunch(), appModeEnv())
  expectProtocolOnly(out, err)
})
