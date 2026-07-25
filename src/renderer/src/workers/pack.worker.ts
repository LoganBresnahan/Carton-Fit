// The pack worker (ADR-0003 phase 5). Runs the packing engines off the UI thread
// — thorough-tier quickhull can take hundreds of ms on a dense mesh, which would
// jank the viewport. Cloned from import.worker.ts: one message in, one response
// out, all engine work behind the worker boundary (CLAUDE.md: core/packing is
// imported only here, by its own internals, and by tests).
import { pack } from '../core/packing/pack'
import type { PackJob, PackResponse } from './pack-protocol'

function handle(job: PackJob): PackResponse {
  try {
    return { id: job.id, ok: true, result: pack(job.request) }
  } catch (err) {
    return { id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

self.onmessage = (event: MessageEvent<PackJob>) => {
  // PackResponse is plain data — no transfer list (see pack-protocol).
  self.postMessage(handle(event.data))
}
