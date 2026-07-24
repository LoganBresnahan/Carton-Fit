// The import worker (ADR-0002). Receives an ImportRequest, parses off the UI
// thread, and returns backend-independent protocol parts: STEP via OpenCascade
// WASM, STL via three's STLLoader. The import pipeline (import/pipeline.ts)
// dispatches by extension; the phase-1 loadOcct() asset wiring is proven in dev,
// packaged file://, and worker contexts.
import { loadOcct } from './occt/loadOcct'
import { extractParts } from './occt/occt-to-parts'
import { STLLoader } from './adapters/stlLoader'
import { bufferGeometryToPart } from './stlToPart'
import {
  resultTransferables,
  type ImportRequest,
  type ImportResult
} from './import-protocol'

/** File base name without extension — STL carries no embedded part name. */
function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  const stem = slash >= 0 ? fileName.slice(slash + 1) : fileName
  const dot = stem.lastIndexOf('.')
  return dot > 0 ? stem.slice(0, dot) : stem
}

async function handleStep(request: ImportRequest): Promise<ImportResult> {
  const occt = await loadOcct()
  // linearUnit 'millimeter' is occt's default and our canonical unit, but pin it
  // explicitly so a future occt default change can't silently rescale.
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
}

function handleStl(request: ImportRequest): ImportResult {
  const geometry = new STLLoader().parse(request.bytes)
  const part = bufferGeometryToPart(geometry, baseName(request.fileName))
  if (part.positions.length === 0) {
    return { id: request.id, ok: false, error: 'STL file contained no triangles' }
  }
  return { id: request.id, ok: true, parts: [part] }
}

async function handle(request: ImportRequest): Promise<ImportResult> {
  try {
    if (request.kind === 'step') return await handleStep(request)
    if (request.kind === 'stl') return handleStl(request)
    return { id: request.id, ok: false, error: `Unsupported file kind: ${request.kind}` }
  } catch (err) {
    return { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const result = await handle(event.data)
  self.postMessage(result, { transfer: resultTransferables(result) })
}
