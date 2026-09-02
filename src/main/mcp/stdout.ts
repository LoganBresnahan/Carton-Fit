import type { Writable } from 'node:stream'

// STDOUT DISCIPLINE (ADR-0029, build-plan slice `stdout-protocol-discipline`).
//
// In server mode this process's stdout IS the MCP wire. One stray byte on it —
// a `console.log` left in a handler, a dependency announcing itself, a
// deprecation notice — lands in the middle of a JSON-RPC frame, and the client
// fails to parse the stream rather than reporting a Carton Fit problem. The
// handshake is the first casualty, which at least makes it loud; a stray write
// AFTER the handshake is worse, because it corrupts one answer inside an
// otherwise working session.
//
// The guard is structural rather than conventional. Redirecting `console.log`
// and friends would cover today's ways of printing and none of tomorrow's — a
// direct `process.stdout.write` from anywhere in the bundle would still get
// through. So instead the real write is CAPTURED and taken away: after this
// runs, `process.stdout.write` — and therefore `console.log`, which calls it —
// goes to stderr, and the only thing holding the real one is the transport.
//
// stderr, deliberately, rather than silence: a message someone bothered to
// print is still worth reading, and Claude Desktop shows a server's stderr in
// its logs. Nothing is lost; it is only moved off the wire.

/**
 * Take stdout away from the process and hand it to the caller.
 *
 * @param stdout the stream to claim — everything written to it from now on is
 * diverted to `stderr` instead.
 * @returns a writer that still reaches the real `stdout`. Give it to the
 * transport and to nothing else.
 */
export function divertStdout(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Writable {
  const realWrite = stdout.write.bind(stdout)

  // Not `stdout.write = …`: on a TTY the property is inherited and assignment
  // would be shadowed differently across platforms. defineProperty is
  // unambiguous, and `configurable` keeps a test able to put it back.
  Object.defineProperty(stdout, 'write', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]): boolean =>
      (stderr.write as (...forwarded: unknown[]) => boolean)(...args)
  })

  // A Proxy rather than a wrapper stream, because BACKPRESSURE HAS TO SURVIVE.
  // The transport writes a frame and, when `write` returns false, waits for the
  // real stream's own `drain` (see StdioServerTransport.send) — a wrapping
  // Writable would answer that question about its own buffer instead, and
  // `capture_view`'s base64 PNG is exactly the payload big enough to make the
  // difference an unbounded buffer. Everything except `write` therefore still
  // goes to the real stream, called with the real stream as `this`.
  return new Proxy(stdout as unknown as Writable, {
    get(target, property) {
      if (property === 'write') return realWrite
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/** The claimed stdout, so the two entries and `serveStdio` can each ask without
 *  the second caller diverting the diversion (which would send the protocol to
 *  stderr and leave the wire silent). */
let claimed: Writable | null = null

/**
 * Claim this process's stdout for the MCP protocol. Idempotent.
 *
 * Called at MODULE LOAD by both entries, not at connect time: the client's
 * transport is reading our stdout from the moment it spawns us, so anything
 * printed during app boot — before the server is even constructed — is already
 * on the wire.
 */
export function claimStdoutForProtocol(): Writable {
  if (claimed === null) claimed = divertStdout(process.stdout, process.stderr)
  return claimed
}
