import { resolveServerOptions, serveStdio } from './mcp/host'

// The HEADLESS MCP entry (ADR-0029, slice `mcp-server-host-in-main`): built to
// out/main/mcp.js and executed as
//
//   ELECTRON_RUN_AS_NODE=1 <shipped binary> <resources>/app.asar/out/main/mcp.js
//
// — the shipped Electron binary running as plain Node (the very mechanism
// CLAUDE.md warns the dev shell about, used on purpose: no second runtime
// ships). Electron APIs are ABSENT here; nothing in this entry's import graph
// may touch 'electron'. Today it serves the stateless v1 tools directly; phase
// 5 grows it into the --mcp shim that proxies to a running app instance, which
// is why it exists as its own build entry rather than as a flag on index.ts.
//
// stdout is the protocol stream. Anything a person should read goes to stderr.

serveStdio(resolveServerOptions(__dirname))
  .then((server) => {
    // Claude Desktop signals shutdown by closing our stdin; a server that
    // lingered past that would accumulate one orphan process per chat session.
    server.server.onclose = () => process.exit(0)
  })
  .catch((err: unknown) => {
    console.error('carton-fit mcp server failed to start:', err)
    process.exit(1)
  })
