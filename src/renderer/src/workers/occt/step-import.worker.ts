// The real STEP import worker (ADR-0002 phase 2). Receives an ImportRequest,
// parses off the UI thread with OpenCascade WASM, and returns protocol parts.
// Supersedes occt-probe.worker — that was phase-1 proof that this module's
// loadOcct()/asset wiring works in dev, packaged file://, and worker contexts.
import { loadOcct } from './loadOcct'
import { extractParts } from './occt-to-parts'
import {
  resultTransferables,
  type ImportRequest,
  type ImportResult
} from '../import-protocol'

async function handle(request: ImportRequest): Promise<ImportResult> {
  if (request.kind !== 'step') {
    // STL routes through three's own loader (phase 5 `stl-loader-path`); this
    // worker only speaks OpenCascade formats.
    return { id: request.id, ok: false, error: `Unsupported kind for this worker: ${request.kind}` }
  }

  try {
    const occt = await loadOcct()
    // linearUnit 'millimeter' is occt's default and our canonical unit, but pin
    // it explicitly so a future occt default change can't silently rescale.
    const result = occt.ReadStepFile(new Uint8Array(request.bytes), { linearUnit: 'millimeter' })

    if (!result.success) {
      return { id: request.id, ok: false, error: 'OpenCascade could not read this STEP file' }
    }
    // Assembly-aware: geometry arrives world-space-baked from occt; extractParts
    // adds instance-disambiguated names from the node tree (ADR-0002 addendum).
    const parts = extractParts(result)
    if (parts.length === 0) {
      return { id: request.id, ok: false, error: 'STEP file parsed but contained no meshes' }
    }
    return { id: request.id, ok: true, parts }
  } catch (err) {
    return {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const result = await handle(event.data)
  self.postMessage(result, { transfer: resultTransferables(result) })
}
