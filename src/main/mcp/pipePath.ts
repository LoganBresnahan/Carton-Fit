import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// WHERE THE PIPE LIVES (ADR-0029, build-plan slice `mcp-shim-single-instance`).
//
// The app listens on a local pipe for MCP sessions; the `--mcp` shim connects
// to it. They are different PROCESSES in different RUNTIMES — the app has
// Electron and can ask `app.getPath('userData')`, the shim is plain Node and
// cannot — so the pipe's name must be derivable from facts both sides share,
// or the shim connects to a pipe nobody is listening on and the failure is a
// silent timeout. That derivation is this module, Electron-free on purpose,
// and everything here is deterministic: same profile in, same name out, in
// both processes, on every platform.
//
// The name is scoped BY PROFILE (userData path), not global: two profiles are
// two separate universes — dev and packaged, a user and an e2e run — and one
// flat name would let an e2e app receive a dogfooder's tool calls. Hashing the
// path (rather than embedding it) keeps the name legal everywhere: the Windows
// pipe namespace is flat with its own character rules, and Unix sockets cap
// the whole PATH around ~104 bytes, which a nested tmpdir profile can blow
// straight through.

/**
 * One profile, one key — the same key from both processes.
 *
 * `resolve` because the two sides may write the same directory differently
 * (trailing slash, relative segment); lowercased on win32 because NTFS paths
 * compare case-insensitively, so `C:\Users` and `c:\users` are one profile and
 * must be one pipe.
 */
export function profileKey(userDataPath: string, platform: NodeJS.Platform): string {
  const canonical =
    platform === 'win32' ? resolve(userDataPath).toLowerCase() : resolve(userDataPath)
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * The pipe endpoint for a profile.
 *
 * win32: a named pipe. The namespace is flat and kernel-managed — pipes vanish
 * with their last handle, so there is no stale-file problem to clean up.
 *
 * elsewhere: a Unix socket file. `XDG_RUNTIME_DIR` when the session provides
 * it (per-user, 0700, cleared at logout — exactly what a session-scoped socket
 * wants), else the tmpdir. NOT inside userData: profile paths have no length
 * budget, and a socket path over the ~104-byte cap fails with an error that
 * says nothing about length.
 */
export function pipePath(
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = profileKey(userDataPath, platform)
  if (platform === 'win32') return `\\\\.\\pipe\\carton-fit-mcp-${key}`
  const dir = env['XDG_RUNTIME_DIR'] ?? tmpdir()
  return join(dir, `carton-fit-mcp-${key}.sock`)
}

/**
 * Where Electron will put this app's userData — computed WITHOUT Electron.
 *
 * The shim needs the profile to name the pipe, and its only launch argument
 * may be nothing at all (Claude Desktop's config passes no profile). So it
 * restates Electron's own rule: the per-platform config root plus the app
 * name, which `app.setName('Carton-Fit')` pins on the app side (ADR-0019 —
 * the name deliberately has no space). These rules are Electron's documented,
 * stable behaviour; a unit test pins each shape so a drift would be a red
 * test, not a shim connecting to the wrong universe.
 */
export function defaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Carton-Fit')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Carton-Fit')
  return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'Carton-Fit')
}
