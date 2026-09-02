import { resolveServerOptions, serveStdio } from './mcp/host'
import { runShim } from './mcp/shim'
import { claimStdoutForProtocol } from './mcp/stdout'

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
// stdout is the protocol stream. Anything a person should read goes to stderr —
// and this line is what makes that true rather than asked for: it runs before
// any other import can print (slice `stdout-protocol-discipline`).

claimStdoutForProtocol()

// TWO MODES from one entry, split by `--mcp` (slice `mcp-shim-single-instance`):
//
//   with `--mcp`  — the SHIM: proxy this stdio to the running app's pipe,
//                   starting a hidden app when none is listening. The full
//                   tool surface, because a real app answers. This is what
//                   Claude Desktop's config points at, and on Windows the only
//                   route to the drive tier (ADR-0029's Windows finding).
//   without       — the original standalone v1 server, kept as-is: the
//                   invocation shipped in the changelog keeps meaning what it
//                   meant (ADR-0020 — additive, not repurposed), and tests get
//                   a serverful mode with no app process behind it.
if (process.argv.includes('--mcp')) {
  runShim(__dirname, process.argv.slice(2)).catch((err: unknown) => {
    console.error('carton-fit --mcp shim failed:', err)
    process.exit(1)
  })
} else {
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
}
