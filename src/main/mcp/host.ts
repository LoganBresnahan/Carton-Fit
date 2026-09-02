import { readFileSync } from 'node:fs'
import type { Server } from 'node:net'
import { join, resolve, sep } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createCartonFitServer, type ServerOptions } from './server'
export type { ServerOptions } from './server'
import { buildId } from './buildId'
import { servePipe } from './pipeServer'
import { claimStdoutForProtocol } from './stdout'

// The server HOST (ADR-0029, build-plan slice `mcp-server-host-in-main`).
//
// `createCartonFitServer` builds a server no transport has been chosen for;
// this module is the one place a transport IS chosen. Keeping that a seam is
// load-bearing: the in-memory transport drives the same server in tests, phase
// 5's single-instance pipe will connect it to a socket, and the HTTP shape
// ADR-0029 demoted-but-kept would be one more `connect` call here — none of
// them a change to any tool.
//
// TWO CALLERS — the app itself (src/main/index.ts, launched with
// --mcp-server) and the headless entry (src/main/mcpEntry.ts, executed with
// ELECTRON_RUN_AS_NODE, where Electron APIs are absent) — and DELIBERATELY ONE
// DERIVATION serving both. Everything Electron could have answered
// (`app.getAppPath()`, `app.getVersion()`) is instead derived from where the
// calling entry file sits on disk, for two reasons:
//
//   1. The headless mode has no `app` to ask, so the derivation must exist.
//   2. Sharing it is what makes the two modes agree BY CONSTRUCTION — one
//      build cannot introduce itself with two versions, or resolve two wasm
//      paths, because there is only one rule. (`app.getVersion()` would also
//      simply be wrong in an e2e launch of out/main/index.js: with no adjacent
//      package.json it reports "0.0" — the same trap ADR-0021 documents.)
//
// This file must never import 'electron' — the import graph is the contract,
// and a stray `import { app }` here would crash the headless mode at require
// time.

/** Serve MCP on this process's stdin/stdout. Resolves once connected; the
 *  transport owns the streams from then on, so in server mode stdout belongs
 *  to the protocol and nothing else may write to it — which
 *  `claimStdoutForProtocol` makes structurally true rather than a convention
 *  (ADR-0029, slice `stdout-protocol-discipline`). Both entries claim it at
 *  module load as well, because boot output precedes this call. */
export async function serveStdio(options: ServerOptions): Promise<McpServer> {
  const server = createCartonFitServer(options)
  await server.connect(new StdioServerTransport(process.stdin, claimStdoutForProtocol()))
  return server
}

/**
 * Serve MCP sessions on a local pipe — the transport the `--mcp` shim dials
 * (slice `mcp-shim-single-instance`), and on Windows the only one that works
 * at all (ADR-0029's Windows finding: a GUI-subsystem process cannot deliver
 * its stdio, so the protocol must ride something that is not stdio).
 *
 * One CONNECTION is one SESSION is one fresh server instance: MCP's
 * initialize handshake is per-connection state, and the SDK's transports are
 * single-connection by design — sharing one server across sockets would share
 * one handshake. The tools stay stateless and the drive bridge serializes
 * globally, so per-session servers cost an object, not a behaviour.
 * `StdioServerTransport` is misleadingly named but exactly right here: it
 * speaks newline-delimited JSON-RPC over any (Readable, Writable) pair, and a
 * socket is both halves.
 *
 * `hooks` exist for the caller's lifecycle arithmetic (index.ts quits a
 * spawned, never-revealed app when its last session ends); the session close
 * is keyed on the SOCKET closing, which covers a clean client exit and a
 * killed one identically.
 */
export function servePipeSessions(
  path: string,
  options: ServerOptions,
  hooks: { onSessionStart(): void; onSessionEnd(): void }
): Promise<Server> {
  return servePipe(path, (socket) => {
    hooks.onSessionStart()
    const server = createCartonFitServer(options)
    socket.once('close', () => {
      void server.close().catch(() => undefined)
      hooks.onSessionEnd()
    })
    void server.connect(new StdioServerTransport(socket, socket)).catch(() => socket.destroy())
  })
}

/** Where the app root is, seen from `out/main` — the Electron-free twin of
 *  `app.getAppPath()`. Exported apart from the fs read so the two path shapes
 *  (repo checkout, `resources/app.asar`) unit-test without either existing. */
export function resolveAppRoot(entryDir: string): { appPath: string; isPackaged: boolean } {
  // The entry is built to <appPath>/out/main/mcp.js in both layouts, so the
  // root is two directories up. Packaged, that root is the asar archive itself
  // — a path Node can read through, because Electron keeps its asar-aware fs
  // patches on in ELECTRON_RUN_AS_NODE mode.
  const appPath = resolve(entryDir, '..', '..')
  return { appPath, isPackaged: appPath.endsWith(`${sep}app.asar`) || appPath.endsWith('.asar') }
}

/**
 * Everything the server needs, derived without Electron from the calling
 * entry's own directory (`__dirname` — out/main in every layout).
 *
 * The version is read from the app root's own package.json — the file
 * `app.getVersion()` reads when it works at all. A root without a readable
 * version is a broken install, and the loud throw here beats a server
 * introducing itself as "undefined".
 *
 * It is then STAMPED with the build id (ADR-0027's `+sha`, slice
 * `one-version-handshake`), so a build that is not its release cannot
 * introduce itself as one. Both server modes go through here, so both say the
 * same thing — the same reason everything else in this file is derived once.
 *
 * @param id overridable so the stamping is testable without a build; the
 * default is the constant electron-vite injected.
 */
export function resolveServerOptions(entryDir: string, id: string = buildId()): ServerOptions {
  const { appPath, isPackaged } = resolveAppRoot(entryDir)
  const manifest = JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`no version in ${join(appPath, 'package.json')} — broken install?`)
  }
  return { occt: { appPath, isPackaged }, version: `${manifest.version}${id}` }
}
