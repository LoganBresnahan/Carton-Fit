import type {
  PackJob,
  PackRequest,
  PackResponse,
  PackResult
} from '../workers/pack-protocol'

// The pack pipeline (ADR-0003 phase 5): main-thread orchestration between the
// settings/parts spine and the pack worker. Pure and worker-injected, exactly
// like the import pipeline — a stub worker drives the whole dispatch + staleness
// path in vitest, no real Worker needed (ADR-0005 layer 1).
//
// Staleness: a pack is triggered by the current inputs (carton, tier, weights,
// mode). When those change while a pack is in flight, a newer request supersedes
// it; only the response whose id equals `latestId` is accepted. This is the same
// id-monotonic guard the import pipeline uses for re-drops, minus the async file
// read — a pack request is already fully formed, so there is no await between
// claiming the id and posting.

/** Minimal structural view of a Worker — a stub satisfies it in tests. */
export interface PackWorkerLike {
  onmessage: ((event: MessageEvent<PackResponse>) => void) | null
  postMessage(message: PackJob): void
  terminate(): void
}

/** Where the pipeline writes pack outcomes. The store implements this (item 4);
 *  tests pass spies. Keeps dispatch logic out of components and testable. */
export interface PackSink {
  begin(): void
  succeed(result: PackResult, elapsedMs: number): void
  fail(error: string): void
}

export interface PackPipeline {
  requestPack(request: PackRequest): void
  dispose(): void
}

type Clock = () => number

export function createPackPipeline(
  worker: PackWorkerLike,
  sink: PackSink,
  now: Clock = () => performance.now()
): PackPipeline {
  let latestId = 0
  const startedAt = new Map<number, number>()

  worker.onmessage = (event) => {
    const response = event.data
    const t0 = startedAt.get(response.id)
    startedAt.delete(response.id)
    if (response.id !== latestId) return // superseded by newer inputs
    if (response.ok) {
      sink.succeed(response.result, t0 === undefined ? 0 : now() - t0)
    } else {
      sink.fail(response.error)
    }
  }

  function requestPack(request: PackRequest): void {
    const id = ++latestId
    sink.begin()
    startedAt.set(id, now())
    // No transfer list: the renderer keeps `positions` for the viewport, so the
    // worker receives a structured-clone copy (see pack-protocol).
    worker.postMessage({ id, request })
  }

  return { requestPack, dispose: () => worker.terminate() }
}
