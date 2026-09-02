import { chmodSync, unlinkSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'

// The pipe LISTENER (ADR-0029, slice `mcp-shim-single-instance`) — the app's
// half of the wire the shim connects to. Electron-free: the caller decides
// what a connection means (a session factory); this module owns only the two
// things a listener can get wrong.
//
// 1. STALE SOCKETS (Unix only). A crash leaves the socket file behind, and the
//    next launch's listen() fails EADDRINUSE against a corpse. The recovery
//    must not be "unlink and listen" unconditionally — the file might belong
//    to a LIVE instance (the single-instance lock should prevent that, but a
//    listener that can steal a live socket turns a lock bug into two apps
//    silently splitting one identity). So: probe it. A connection REFUSED
//    means corpse (unlink, retry once); a connection ACCEPTED means live
//    (fail loudly, serve nothing). Windows named pipes vanish with their last
//    handle — the kernel does this module's cleanup for it.
//
// 2. PERMISSIONS (Unix only). The socket is a door into the user's app;
//    0600 keeps it that user's door. XDG_RUNTIME_DIR is already per-user 0700,
//    but the tmpdir fallback is world-traversable, so the chmod is not
//    redundant. Windows named pipes get a same-user default DACL.

/** True for a Windows named-pipe path, where the fs-level handling (stale
 *  files, chmod, unlink-on-close) neither applies nor works. */
function isWindowsPipe(path: string): boolean {
  return path.startsWith('\\\\.\\pipe\\')
}

/**
 * Listen on `path`, calling `onConnection` per client.
 *
 * Resolves once listening; rejects when the address is genuinely unusable —
 * including the held-by-a-live-instance case, which the caller should treat
 * as "serve nothing, keep running": the app is still an app without its pipe.
 */
export function servePipe(path: string, onConnection: (socket: Socket) => void): Promise<Server> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(onConnection)
    let recovered = false

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE' || isWindowsPipe(path) || recovered) {
        rejectPromise(err)
        return
      }
      recovered = true // one recovery attempt; a second EADDRINUSE is a real answer
      const probe = connect(path)
      probe.once('connect', () => {
        probe.destroy()
        rejectPromise(
          new Error(`another instance is already serving ${path} — refusing to steal its socket`)
        )
      })
      probe.once('error', () => {
        // Nothing answered: a corpse (or a plain file squatting the name).
        try {
          unlinkSync(path)
        } catch {
          // Unlink failing means the retry below will report the real problem.
        }
        server.listen(path)
      })
    })

    server.once('listening', () => {
      if (!isWindowsPipe(path)) {
        try {
          chmodSync(path, 0o600)
        } catch {
          // Permissions are defence in depth, not a reason to refuse to serve.
        }
      }
      resolvePromise(server)
    })

    server.listen(path)
  })
}
