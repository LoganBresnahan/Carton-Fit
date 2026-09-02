import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { resolveAppRoot } from './host'
import { defaultUserDataPath, pipePath } from './pipePath'
import { claimStdoutForProtocol } from './stdout'

// The `--mcp` SHIM (ADR-0029, slice `mcp-shim-single-instance`): what Claude
// Desktop's config actually launches. A dumb byte proxy between the client's
// stdio and the app's pipe — it parses nothing, frames nothing, and holds no
// protocol state, which is precisely what lets it preserve framing,
// backpressure and EOF: `pipe()` end to end, transparency by construction.
//
// It exists for two reasons that turned out to be one:
//
//   1. LAUNCH ORDER (the designed reason): the client must connect whether or
//      not the app is running. The shim tries the pipe; nothing there means no
//      app, so it starts one — hidden, per phase 4 — and connects to that.
//   2. WINDOWS (the discovered reason — ADR-0029's Windows finding): a
//      GUI-subsystem Electron process cannot deliver its stdout to the parent
//      that spawned it, so hosting MCP on the APP's stdio is unworkable on the
//      primary target. The shim runs under ELECTRON_RUN_AS_NODE — the mode
//      proven to speak on Windows — and the GUI process never owns a protocol
//      stream at all.
//
// LIFECYCLE, stated once: the shim's life is the client's (stdin EOF → pipe
// closed → exit); the app's life is its own. Quit the app mid-session and the
// shim sees EOF and exits — quit means quit, and the next question boots the
// app again, hidden. The spawned app is detached and unref'd for exactly that
// reason: it must outlive this shim (the next session connects instantly),
// and index.ts's idle rule quits it when nobody — client or window — needs it.

/** How long a just-spawned app may take to start listening. Cold boot on a
 *  slow disk is seconds; this is the backstop, not the expectation. */
const SPAWN_CONNECT_DEADLINE_MS = 20_000
const CONNECT_RETRY_STEP_MS = 250

export interface ShimPlan {
  /** The profile whose pipe to dial — from `--user-data-dir` when given (the
   *  e2e harness's isolation mechanism), else Electron's documented default. */
  userData: string
  /** Arguments for the app if one must be spawned: the server-mode flags plus
   *  every argument the shim itself received (minus `--mcp`), passed through
   *  verbatim — the config is the natural place to hand the app a flag, and
   *  the harness rides the same mechanism for its GL switches. */
  appArgs: string[]
}

/** Pure so a unit test can pin the contract without spawning anything. */
export function planShim(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ShimPlan {
  const passthrough = argv.filter((arg) => arg !== '--mcp')
  const profileArg = argv.find((arg) => arg.startsWith('--user-data-dir='))
  const userData =
    profileArg !== undefined
      ? profileArg.slice('--user-data-dir='.length)
      : defaultUserDataPath(platform, env)
  return { userData, appArgs: ['--mcp-server', '--mcp-spawned', ...passthrough] }
}

/**
 * What to spawn when no app is listening. Pure given its facts, so the
 * packaged/dev split is pinned by test rather than discovered in Claude
 * Desktop's error log.
 *
 * Packaged, `process.execPath` IS the app binary — the shim runs as Node
 * inside the shipped Electron, so the app it should start is itself, launched
 * without the run-as-node veil. In a repo checkout there is no such binary;
 * the dev Electron and the built entry stand in.
 */
export function spawnTarget(facts: {
  isPackaged: boolean
  appPath: string
  execPath: string
  electronBinary: () => string
  appArgs: string[]
}): { command: string; args: string[] } {
  if (facts.isPackaged) return { command: facts.execPath, args: facts.appArgs }
  return {
    command: facts.electronBinary(),
    args: [join(facts.appPath, 'out', 'main', 'index.js'), ...facts.appArgs]
  }
}

function connectOnce(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(path)
    socket.once('connect', () => {
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(null)
    })
  })
}

async function connectUntil(path: string, deadlineMs: number): Promise<Socket | null> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const socket = await connectOnce(path)
    if (socket !== null) return socket
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_STEP_MS))
  }
}

function spawnApp(entryDir: string, appArgs: string[]): void {
  const { appPath, isPackaged } = resolveAppRoot(entryDir)
  const target = spawnTarget({
    isPackaged,
    appPath,
    execPath: process.execPath,
    // Lazy and dev-only ON PURPOSE: in a checkout, node_modules/electron's
    // entry exports the binary's path when required as plain Node. Packaged
    // builds have no node_modules — this thunk must never run there, and the
    // isPackaged split above is what guarantees it doesn't.
    electronBinary: () => createRequire(__filename)('electron') as string,
    appArgs
  })
  // The child must NOT inherit run-as-node, or it boots as a script host
  // instead of an app — the exact variable the shim itself runs under.
  // DELETED, not blanked: Electron tests presence (e2e/harness.ts learned
  // this on windows-latest).
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  spawn(target.command, target.args, { detached: true, stdio: 'ignore', env }).unref()
}

/** Wire client stdio to the app socket and get out of the way. */
function proxy(socket: Socket, protocolStdout: Writable): void {
  // pipe() in both directions is the whole point: backpressure propagates
  // through the built-in machinery (a slow reader pauses the writer), EOF
  // travels as end() (client hangup reaches the app; app death reaches the
  // client), and bytes are never inspected, so framing cannot be damaged
  // here. stdin starts paused; nothing is lost before this line runs.
  process.stdin.pipe(socket)
  socket.pipe(protocolStdout)
  socket.once('close', () => process.exit(0))
  socket.once('error', (err: Error) => {
    process.stderr.write(`carton-fit --mcp: connection to the app failed: ${err.message}\n`)
    process.exit(1)
  })
}

/**
 * Run the shim: connect to the app, starting one if none is listening.
 *
 * The connect-vs-launch race is settled by NOT trying to win it: two shims
 * racing both spawn, the two apps race the single-instance lock, the loser
 * exits, and both shims' retry loops land on whichever instance holds the
 * pipe. Nothing here needs to know who won.
 */
export async function runShim(entryDir: string, argv: readonly string[]): Promise<void> {
  const protocolStdout = claimStdoutForProtocol()
  const plan = planShim(argv)
  const pipe = pipePath(plan.userData)

  let socket = await connectOnce(pipe)
  if (socket === null) {
    spawnApp(entryDir, plan.appArgs)
    socket = await connectUntil(pipe, SPAWN_CONNECT_DEADLINE_MS)
  }
  if (socket === null) {
    process.stderr.write(
      `carton-fit --mcp: the app did not start listening on ${pipe} within ` +
        `${SPAWN_CONNECT_DEADLINE_MS / 1000}s — is the installation broken?\n`
    )
    process.exit(1)
  }
  proxy(socket, protocolStdout)
}
