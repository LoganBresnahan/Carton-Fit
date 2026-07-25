import { describe, expect, it, vi } from 'vitest'
import { createPackPipeline, type PackWorkerLike } from '../src/renderer/src/packing/pipeline'
import type { PackJob, PackResponse, PackRequest, PackResult } from '../src/renderer/src/workers/pack-protocol'
import type { PackSink } from '../src/renderer/src/packing/types'

// Stub worker: records jobs and lets the test push responses, so the pipeline's
// dispatch + staleness logic runs with no real Worker and no engine (ADR-0005
// layer 1), mirroring the import pipeline test.
class StubWorker implements PackWorkerLike {
  onmessage: ((event: MessageEvent<PackResponse>) => void) | null = null
  posted: PackJob[] = []
  terminated = false
  postMessage(message: PackJob): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  respond(response: PackResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<PackResponse>)
  }
  get lastId(): number {
    return this.posted[this.posted.length - 1].id
  }
}

function spySink(): PackSink & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    begin: vi.fn(() => calls.push('begin')),
    succeed: vi.fn((result: PackResult) => calls.push(`succeed:${result.mode}`)),
    fail: vi.fn((err: string) => calls.push(`fail:${err}`))
  }
}

const REQUEST: PackRequest = {
  mode: 'fit-check',
  tier: 'fast',
  carton: [100, 100, 100],
  clearances: { betweenParts: 0, wall: 0 },
  maxWeightG: Infinity,
  parts: []
}

function fitResult(): PackResult {
  return {
    mode: 'fit-check',
    tier: 'fast',
    fits: true,
    unplaced: [],
    placements: [],
    binding: 'geometry',
    heuristic: true,
    utilization: 0
  }
}

describe('createPackPipeline', () => {
  it('begins on request and posts a job with the request', () => {
    const worker = new StubWorker()
    const sink = spySink()
    createPackPipeline(worker, sink).requestPack(REQUEST)

    expect(sink.begin).toHaveBeenCalledOnce()
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0].request).toBe(REQUEST)
    expect(worker.posted[0].id).toBe(1)
  })

  it('maps a success response to succeed with elapsed timing', () => {
    const worker = new StubWorker()
    const sink = spySink()
    let clock = 200
    createPackPipeline(worker, sink, () => clock).requestPack(REQUEST)

    clock = 235 // 35 ms elapse
    worker.respond({ id: worker.lastId, ok: true, result: fitResult() })

    expect(sink.succeed).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fit-check' }), 35)
  })

  it('maps an error response to fail', () => {
    const worker = new StubWorker()
    const sink = spySink()
    createPackPipeline(worker, sink).requestPack(REQUEST)

    worker.respond({ id: worker.lastId, ok: false, error: 'engine blew up' })

    expect(sink.fail).toHaveBeenCalledWith('engine blew up')
  })

  it('ignores a stale response after newer inputs supersede it', () => {
    const worker = new StubWorker()
    const sink = spySink()
    const pipeline = createPackPipeline(worker, sink)

    pipeline.requestPack(REQUEST)
    const firstId = worker.lastId
    pipeline.requestPack(REQUEST) // inputs changed → newer pack
    const secondId = worker.lastId
    expect(secondId).toBeGreaterThan(firstId)

    worker.respond({ id: firstId, ok: true, result: fitResult() }) // late, dropped
    worker.respond({ id: secondId, ok: true, result: fitResult() }) // current, wins

    expect(sink.succeed).toHaveBeenCalledOnce()
  })

  it('disposes the worker', () => {
    const worker = new StubWorker()
    createPackPipeline(worker, spySink()).dispose()
    expect(worker.terminated).toBe(true)
  })
})
