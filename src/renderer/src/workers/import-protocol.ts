// The renderer ⇄ import-worker message contract. This is ADR-0002's swap seam:
// it names meshes, not OpenCascade. Any parser backend (occt today, a native
// sidecar later) speaks this protocol, and every consumer — three.js geometry,
// bbox, mesh-volume — reads these types, so keep it backend-agnostic. Freeze the
// shape before phase-2 consumers depend on it.

export type ImportKind = 'step' | 'stl'

/** Renderer → worker. `bytes` is transferred (not copied) — see requestTransferables. */
export interface ImportRequest {
  /** Correlates a response to its request; monotonic per session. */
  id: number
  fileName: string
  kind: ImportKind
  /** Raw file contents. Ownership moves to the worker on postMessage. */
  bytes: ArrayBuffer
}

/**
 * One mesh extracted from the file. Geometry only: bounding boxes and volume are
 * derived downstream by dedicated consumers (three-geometry-and-bboxes,
 * mesh-volume), never carried on the wire. All typed arrays own a distinct
 * ArrayBuffer so they can be transferred; a backend reading views over a shared
 * heap (e.g. occt's WASM memory) must copy into fresh buffers before sending.
 */
export interface ImportedPart {
  name: string
  /** Flat xyz vertex positions, in millimeters (CLAUDE.md canonical unit). */
  positions: Float32Array
  /** Flat xyz per-vertex normals, or null when the source supplies none. */
  normals: Float32Array | null
  /** Triangle vertex indices, three per triangle. */
  indices: Uint32Array
}

/** Worker → renderer, success. */
export interface ImportOk {
  id: number
  ok: true
  parts: ImportedPart[]
}

/** Worker → renderer, failure (unparseable file, empty result, worker crash). */
export interface ImportError {
  id: number
  ok: false
  /** Human-readable reason, surfaced through the DropZone error slot. */
  error: string
}

export type ImportResult = ImportOk | ImportError

// ---------------------------------------------------------------------------
// Transfer-list discipline
//
// postMessage's transfer list names the underlying ArrayBuffers, never the
// views. A buffer backing several views must appear exactly once — listing it
// twice throws DataCloneError — so we dedupe by buffer identity.
// ---------------------------------------------------------------------------

/** Distinct transferable ArrayBuffers behind a set of views. Nulls are skipped;
 *  SharedArrayBuffers (not transferable) are excluded by the instanceof check. */
export function collectBuffers(
  views: ReadonlyArray<ArrayBufferView | ArrayBuffer | null | undefined>
): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>()
  const out: ArrayBuffer[] = []
  for (const view of views) {
    if (!view) continue
    const buffer = view instanceof ArrayBuffer ? view : view.buffer
    if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
      seen.add(buffer)
      out.push(buffer)
    }
  }
  return out
}

/** Transfer list for an outbound request: the file bytes. */
export function requestTransferables(request: ImportRequest): Transferable[] {
  return collectBuffers([request.bytes])
}

/** Transfer list for an outbound result: every part's geometry buffers, deduped.
 *  Errors carry no geometry, so nothing is transferred. */
export function resultTransferables(result: ImportResult): Transferable[] {
  if (!result.ok) return []
  const views: Array<ArrayBufferView | null> = []
  for (const part of result.parts) {
    views.push(part.positions, part.normals, part.indices)
  }
  return collectBuffers(views)
}
