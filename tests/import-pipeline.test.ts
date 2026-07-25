import { describe, expect, it, vi } from 'vitest'
import { createImportPipeline, importKindFor, type ImportWorkerLike } from '../src/renderer/src/import/pipeline'
import type { ImportSink } from '../src/renderer/src/import/types'
import type { ImportRequest, ImportResult, ImportedPart } from '../src/renderer/src/workers/import-protocol'

// Stub worker: records posts and lets the test push responses at will, so the
// pipeline's dispatch + staleness logic runs with zero WASM (ADR-0005 layer 1).
class StubWorker implements ImportWorkerLike {
  onmessage: ((event: MessageEvent<ImportResult>) => void) | null = null
  posted: ImportRequest[] = []
  terminated = false
  postMessage(message: ImportRequest): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  respond(result: ImportResult): void {
    this.onmessage?.({ data: result } as MessageEvent<ImportResult>)
  }
  get lastId(): number {
    return this.posted[this.posted.length - 1].id
  }
}

function spySink(): ImportSink & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    begin: vi.fn((f) => calls.push(`begin:${f.name}`)),
    succeed: vi.fn((parts) => calls.push(`succeed:${parts.length}`)),
    fail: vi.fn((err) => calls.push(`fail:${err}`))
  }
}

function file(name: string, bytes = 8): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  return { name, size: bytes, arrayBuffer: async () => new ArrayBuffer(bytes) }
}

function part(name: string, triangles: number): ImportedPart {
  return {
    name,
    positions: new Float32Array(9),
    normals: null,
    indices: new Uint32Array(triangles * 3)
  }
}

describe('importKindFor', () => {
  it('maps extensions case-insensitively', () => {
    expect(importKindFor('a.STP')).toBe('step')
    expect(importKindFor('a.step')).toBe('step')
    expect(importKindFor('a.stl')).toBe('stl')
    expect(importKindFor('a.obj')).toBeNull()
  })
})

describe('createImportPipeline', () => {
  it('begins on dispatch and posts a step request with the file bytes', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    await pipeline.importFile(file('cube.stp', 16))

    expect(sink.begin).toHaveBeenCalledWith({ name: 'cube.stp', sizeBytes: 16 })
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0].kind).toBe('step')
    expect(worker.posted[0].bytes.byteLength).toBe(16)
  })

  it('maps a success response to succeed with part/triangle/timing stats', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    let clock = 100
    const pipeline = createImportPipeline(worker, sink, () => clock)

    await pipeline.importFile(file('cube.stp'))
    clock = 142 // 42ms elapse between dispatch and response
    worker.respond({ id: worker.lastId, ok: true, parts: [part('a', 4), part('b', 6)] })

    expect(sink.succeed).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'a' }), expect.objectContaining({ name: 'b' })],
      { elapsedMs: 42, partCount: 2, triangleCount: 10 },
      // SHA-256 of the stub's bytes, captured before the buffer is transferred
      // (ADR-0007 history identity).
      expect.stringMatching(/^[0-9a-f]{64}$/)
    )
  })

  it('maps an error response to fail', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    await pipeline.importFile(file('bad.stp'))
    worker.respond({ id: worker.lastId, ok: false, error: 'unparseable' })

    expect(sink.fail).toHaveBeenCalledWith('unparseable')
  })

  it('fails an unsupported extension without dispatching to the worker', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    await pipeline.importFile(file('model.obj'))

    expect(worker.posted).toHaveLength(0)
    expect(sink.fail).toHaveBeenCalledWith('Unsupported file type: model.obj')
  })

  it('ignores a stale response after a re-drop supersedes it', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    await pipeline.importFile(file('first.stp'))
    const firstId = worker.lastId
    await pipeline.importFile(file('second.stp'))
    const secondId = worker.lastId
    expect(secondId).toBeGreaterThan(firstId)

    // First parse finishes LATE (arrives after the second drop) — must be dropped.
    worker.respond({ id: firstId, ok: true, parts: [part('stale', 1)] })
    // Second parse — the current one — wins.
    worker.respond({ id: secondId, ok: true, parts: [part('winner', 2)] })

    expect(sink.succeed).toHaveBeenCalledTimes(1)
    expect(sink.succeed).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'winner' })],
      expect.anything(),
      expect.any(String)
    )
  })

  it('drops a file superseded while its bytes are still being read', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    // A slow-reading file whose arrayBuffer resolves after the next drop begins.
    let releaseSlow: (buf: ArrayBuffer) => void = () => {}
    const slow = {
      name: 'slow.stp',
      size: 4,
      arrayBuffer: () => new Promise<ArrayBuffer>((res) => (releaseSlow = res))
    }
    const slowPromise = pipeline.importFile(slow)
    await pipeline.importFile(file('fast.stp')) // supersedes slow
    releaseSlow(new ArrayBuffer(4))
    await slowPromise

    // Only the fast file reached the worker; slow's bytes were dropped post-read.
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0].fileName).toBe('fast.stp')
  })

  it('reports a file-read failure as fail', async () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createImportPipeline(worker, sink)

    await pipeline.importFile({
      name: 'x.stp',
      size: 4,
      arrayBuffer: async () => {
        throw new Error('read error')
      }
    })

    expect(sink.fail).toHaveBeenCalledWith('read error')
    expect(worker.posted).toHaveLength(0)
  })

  it('disposes the worker', () => {
    const worker = new StubWorker()
    createImportPipeline(worker, spySink()).dispose()
    expect(worker.terminated).toBe(true)
  })
})
