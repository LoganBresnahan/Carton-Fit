import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { divertStdout } from '../src/main/mcp/stdout'

// The stdout guard (ADR-0029, slice `stdout-protocol-discipline`).
//
// The property under test is not "console.log was reassigned" — it is that
// AFTER the claim, the stream object itself no longer reaches stdout, whoever
// holds it and however they write. That is what makes the guard survive a
// future dependency that prints without going through `console`.

/** A stream that records what it was handed, standing in for the real fds. */
function sink(): PassThrough & { text(): string } {
  const stream = new PassThrough() as PassThrough & { text(): string }
  const chunks: string[] = []
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
  stream.text = (): string => chunks.join('')
  return stream
}

describe('divertStdout', () => {
  it('sends everything written to the claimed stream to stderr instead', () => {
    const out = sink()
    const err = sink()
    divertStdout(out, err)

    out.write('a stray message\n')

    expect(err.text()).toBe('a stray message\n')
    expect(out.text()).toBe('')
  })

  it('diverts a DIRECT write, not merely a console call', () => {
    // The case console-reassignment misses, and the reason this guard patches
    // the stream instead: a bundled dependency writing to the fd by hand.
    const out = sink()
    const err = sink()
    const protocol = divertStdout(out, err)

    const holder: { write(text: string): boolean } = out
    holder.write('printed by something that never heard of console')

    expect(err.text()).toContain('never heard of console')
    // …and the protocol writer is unaffected by the diversion, or the wire
    // would go silent in exchange for a clean one.
    protocol.write('{"jsonrpc":"2.0"}\n')
    expect(out.text()).toBe('{"jsonrpc":"2.0"}\n')
  })

  it('gives the protocol writer the REAL stream, backpressure included', () => {
    // The transport writes a frame and waits on the real stream's own `drain`
    // when `write` says false (StdioServerTransport.send). A wrapper with its
    // own buffer would answer that question about itself, so the return value
    // and the event have to come from the claimed stream — checked here by
    // making the real stream say false and seeing that answer come back.
    const out = sink()
    const err = sink()
    const protocol = divertStdout(out, err)

    // Nothing is reading `blocked`, so its buffer fills and `write` returns
    // false — the real signal, observed through the proxy.
    const blocked = new PassThrough({ highWaterMark: 1 })
    const blockedProtocol = divertStdout(blocked, err)
    blockedProtocol.write('x'.repeat(64))
    expect(blockedProtocol.write('y'.repeat(64))).toBe(false)

    // `once` must reach the real stream too, or the drain wait never resolves.
    let drained = false
    blockedProtocol.once('drain', () => {
      drained = true
    })
    blocked.resume()
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(drained).toBe(true)
        expect(protocol.write('still fine')).toBe(true)
        resolve()
      }, 20)
    })
  })
})
