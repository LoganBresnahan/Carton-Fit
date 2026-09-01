import { readFile } from 'node:fs/promises'
import occtFactory, { type OcctModule } from 'occt-import-js'
import { extractParts } from '../../renderer/src/workers/occt/occt-to-parts'
import type { ImportedPart } from '../../renderer/src/workers/import-protocol'
import { resolveOcctWasm, type OcctWasmContext } from './wasmPath'
import { STLLoader } from '../../renderer/src/workers/adapters/stlLoader'
import { bufferGeometryToPart } from '../../renderer/src/workers/stlToPart'

// STEP ingestion in the MAIN process (ADR-0029 phase 1). The renderer keeps its
// import worker exactly as it is; this is the same pipeline reached from the
// other side of the app, because the MCP server's stateless v1 tools answer
// about a file on disk with no window involved.
//
// It is deliberately the same pipeline and not a second one: `extractParts` is
// the shared, backend-agnostic adapter (ADR-0002), `ImportedPart` is the shared
// protocol shape every core consumer already reads, and the wasm is the shared
// shipped binary (see wasmPath.ts). What differs is only how the two sides get
// their bytes and their module — `fs` and a path here, `fetch` and a URL there.
//
// PATHS, NOT BYTES (ADR-0029): a tool call names a file the user already has;
// nothing large crosses the wire.

const STEP_EXTENSIONS = ['.step', '.stp']

let occtPromise: Promise<OcctModule> | null = null

/**
 * Instantiate OpenCascade once per process, ~11 MB of wasm compiled on first
 * use. `locateFile` is the whole point: Emscripten would otherwise look for the
 * binary next to the glue, and the glue is bundled into out/main while the wasm
 * lives with the renderer's assets.
 */
export function loadOcct(wasmPath: string): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = occtFactory({ locateFile: () => wasmPath })
  }
  return occtPromise
}

/** Test seam: forget the memoized module so a test can point at another wasm. */
export function resetOcctForTests(): void {
  occtPromise = null
}

function hasStepExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return STEP_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Read a STEP file from disk into protocol parts, world-space and named.
 *
 * Errors are the ones a caller can act on and are worded for a person reading
 * them through an AI client, which is the only place they will ever be seen:
 * unreadable file, unparseable STEP, parsed-but-empty.
 */
export async function ingestStepFile(
  filePath: string,
  context: OcctWasmContext
): Promise<ImportedPart[]> {
  let bytes: Buffer
  try {
    bytes = await readFile(filePath)
  } catch (err) {
    throw new Error(`could not read ${filePath}: ${err instanceof Error ? err.message : err}`)
  }

  const occt = await loadOcct(resolveOcctWasm(context))
  // 'millimeter' is occt's default AND our canonical unit (CLAUDE.md), pinned
  // explicitly so a future occt default cannot silently rescale every estimate.
  const result = occt.ReadStepFile(new Uint8Array(bytes), { linearUnit: 'millimeter' })
  if (!result.success) {
    throw new Error(`OpenCascade could not read this STEP file: ${filePath}`)
  }

  const parts = extractParts(result)
  if (parts.length === 0) {
    throw new Error(`STEP file parsed but contained no meshes: ${filePath}`)
  }
  return parts
}

/** File base name without extension — STL carries no embedded part name, so the
 *  file names the part, exactly as the import worker does it. */
function baseName(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const stem = slash >= 0 ? filePath.slice(slash + 1) : filePath
  const dot = stem.lastIndexOf('.')
  return dot > 0 ? stem.slice(0, dot) : stem
}

/**
 * Read an STL file from disk into a single protocol part.
 *
 * Uses three's `STLLoader` through the same one-line adapter the import worker
 * uses (ADR-0008's one-adapter-per-jsm-path rule), so there is one STL parser in
 * this app and not two. That decision costs ~330 KB of three bundled into
 * out/main — see the ADR-0029 phase-2 note. The alternative was writing a second
 * STL reader for the main process, which is exactly the duplicate-implementation
 * the ADR forbids: it would eventually disagree with the renderer's, and the
 * disagreement would surface as an AI client quoting a volume the app's own
 * screen contradicts.
 */
export async function ingestStlFile(filePath: string): Promise<ImportedPart[]> {
  let bytes: Buffer
  try {
    bytes = await readFile(filePath)
  } catch (err) {
    throw new Error(`could not read ${filePath}: ${err instanceof Error ? err.message : err}`)
  }
  // A fresh ArrayBuffer: `Buffer` is a view into a pooled allocation, so passing
  // `bytes.buffer` hands the parser every other small allocation Node made too.
  const geometry = new STLLoader().parse(new Uint8Array(bytes).buffer)
  const part = bufferGeometryToPart(geometry, baseName(filePath))
  if (part.positions.length === 0) {
    throw new Error(`STL file contained no triangles: ${filePath}`)
  }
  return [part]
}

/** Ingest whatever model file the caller names, by extension — the same two
 *  formats the app itself accepts (ADR-0002), reached from the other side. */
export async function readModel(
  filePath: string,
  context: OcctWasmContext
): Promise<ImportedPart[]> {
  if (hasStepExtension(filePath)) return ingestStepFile(filePath, context)
  if (filePath.toLowerCase().endsWith('.stl')) return ingestStlFile(filePath)
  throw new Error(`not a model file this app reads (.step, .stp, .stl): ${filePath}`)
}
