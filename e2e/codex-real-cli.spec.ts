import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCodexCli, parseCodexGet } from '../src/main/connect/codexCli'
import { MCP_SERVER_KEY } from '../src/shared/connect'
import { launchApp } from './harness'

/**
 * The same contract, against the real `codex` (ADR-0030 Decision 7, slice
 * `real-codex-conditional-spec`).
 *
 * `codex-connect.spec.ts` proves the adapter agrees with a fake built from a
 * contract we WROTE DOWN. Only this file can notice that contract drifting away
 * from OpenAI's tool — the `--json` shape moving, `--` losing its meaning, a
 * re-add stopping being idempotent — because it drives the actual binary. It is
 * ADR-0030's first revisit trigger, in executable form.
 *
 * IT SKIPS ALMOST EVERYWHERE, and that is the honest state of this coverage
 * rather than a gap to fix later: no CI runner has Codex installed, so on CI and
 * on a developer machine without it this file reports skipped and the fake is
 * all that ran. Where it does run — the requesting machine, and any dogfooder
 * with Codex — it is the check that the recording still holds.
 *
 * Discovery is `findCodexCli` itself, not a second search: a spec that looked
 * elsewhere could pass against a `codex` the app would never choose. It also
 * requires `CODEX_CLI` to be UNSET, since that override is the fake's seam and
 * an override in the environment would make this file quietly re-run the fake
 * test under a name promising the real one.
 *
 * `~/.codex` IS NEVER TOUCHED. Everything below runs under a throwaway
 * `CODEX_HOME`, and the entry it adds is removed at the end — including on
 * failure — so a dogfooder's own Codex configuration is neither read nor
 * written by a test run. `add` is known to behave differently in a temp home
 * (it declines to create PATH aliases there); that difference is the subject of
 * an open detail in the ADR and is observed by dogfooding, not here.
 *
 * The BODY is not untested code waiting for a dogfooder: it was run green by
 * putting the fake CLI on `PATH` under the name `codex`, which is the same
 * discovery route a real one takes. What waits for a real machine is only the
 * question this file exists to ask — whether OpenAI's tool still answers the
 * way we wrote down.
 */

function realCli(): string | null {
  const override = process.env.CODEX_CLI
  if (override !== undefined && override !== '') return null
  return findCodexCli({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    listBinDirs: (root) => {
      try {
        return readdirSync(root, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => ({ name: item.name, mtimeMs: statSync(join(root, item.name)).mtimeMs }))
      } catch {
        return []
      }
    },
    exists: (path) => existsSync(path)
  })
}

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Run the real CLI the way the adapter does — argv, no shell, no window, and
 *  a non-zero exit returned as data because `get` on an unknown name is one. */
function codex(binary: string, home: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: 20_000, windowsHide: true, env: { ...process.env, CODEX_HOME: home } },
      (err, stdout, stderr) => {
        if (err === null) return resolve({ code: 0, stdout, stderr })
        const failure = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean }
        if (typeof failure.code === 'number' && failure.killed !== true) {
          return resolve({ code: failure.code, stdout, stderr })
        }
        return reject(err)
      }
    )
  })
}

test('the real Codex CLI still answers the way ADR-0030 recorded it', async () => {
  const binary = realCli()
  test.skip(binary === null, 'no real codex on this machine (or CODEX_CLI is set)')
  if (binary === null) return
  test.setTimeout(180_000)

  const home = mkdtempSync(join(tmpdir(), 'pe-codex-real-'))
  const profile = mkdtempSync(join(tmpdir(), 'pe-codex-real-profile-'))
  process.env.CODEX_HOME = home
  let app
  try {
    // CODEX_CLI stays unset: main discovers the same binary `realCli()` did,
    // through its own rules. This is the one place both halves of discovery and
    // the spawn meet the real program.
    app = await launchApp([`--user-data-dir=${profile}`])
  } finally {
    delete process.env.CODEX_HOME
  }

  try {
    // A fresh home has no entry, so the row is the ordinary starting state —
    // which is also the assertion that `get` on an unknown name exits 1 rather
    // than failing some other way the adapter would report as an error.
    await app.page.waitForSelector('[data-testid="connect-codex-not-connected"]')
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')

    // Read it back with the real CLI and OUR parser: `connected` above already
    // means main round-tripped this, and doing it again here is what turns a
    // green row into evidence about the CLI's `--json` rather than about us.
    const got = await codex(binary, home, ['mcp', 'get', MCP_SERVER_KEY, '--json'])
    expect(got.code).toBe(0)
    const server = parseCodexGet(got.stdout)
    expect(server, `codex --json in a shape we do not recognise:\n${got.stdout}`).not.toBeNull()
    if (server === null) return

    // The same fields the fake pins — asserted here against a store we do not
    // own, which is the whole point of the file.
    expect(server.enabled).toBe(true)
    expect(server.entry.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    expect(server.entry.args).toContain('--mcp')
    expect(server.entry.args).toContain(`--user-data-dir=${profile}`)
    // `--` survived: our dash-leading arguments reached the SERVER's argv
    // instead of being eaten as Codex's own flags.
    expect(server.entry.command).not.toBe('')
    expect(existsSync(server.entry.command)).toBe(true)

    // Idempotent by name, on the real thing: a second add replaces in place,
    // which is why `connect()` is one call rather than remove-then-add.
    //
    // Asserted through `get` rather than by counting entries in `list --json`,
    // whose shape ADR-0030 never recorded — and a duplicate has nowhere to hide
    // anyway: TOML forbids defining `[mcp_servers.carton-fit]` twice, so an add
    // that appended instead of replacing leaves a file the CLI itself can no
    // longer read, and this `get` is how that arrives.
    await app.page.click('[data-testid="connect-codex-connect"]')
    await app.page.waitForSelector('[data-testid="connect-codex-connected"]')
    const again = await codex(binary, home, ['mcp', 'get', MCP_SERVER_KEY, '--json'])
    expect(again.code).toBe(0)
    expect(parseCodexGet(again.stdout)?.entry).toEqual(server.entry)
  } finally {
    await app.app.close()
    // Removed whatever happened above — and the removal is itself the last
    // recorded behaviour under test.
    const removed = await codex(binary, home, ['mcp', 'remove', MCP_SERVER_KEY])
    expect(removed.code).toBe(0)
    const gone = await codex(binary, home, ['mcp', 'get', MCP_SERVER_KEY, '--json'])
    expect(gone.code).toBe(1)
    expect(`${gone.stderr}${gone.stdout}`).toContain(MCP_SERVER_KEY)
  }
})
