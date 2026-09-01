import { readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createCartonFitServer, type ServerOptions } from './server'

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
 *  to the protocol and nothing else may write to it (ADR-0029). */
export async function serveStdio(options: ServerOptions): Promise<McpServer> {
  const server = createCartonFitServer(options)
  await server.connect(new StdioServerTransport())
  return server
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
 * introducing itself as "undefined". (The `+sha` staged-build form is phase
 * 4's `one-version-handshake`.)
 */
export function resolveServerOptions(entryDir: string): ServerOptions {
  const { appPath, isPackaged } = resolveAppRoot(entryDir)
  const manifest = JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`no version in ${join(appPath, 'package.json')} — broken install?`)
  }
  return { occt: { appPath, isPackaged }, version: manifest.version }
}
