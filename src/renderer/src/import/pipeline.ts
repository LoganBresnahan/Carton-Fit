import {
  requestTransferables,
  type ImportedPart,
  type ImportKind,
  type ImportRequest,
  type ImportResult
} from '../workers/import-protocol'
import type { ImportSink, ImportStats } from './types'

// The drop→import pipeline (ADR-0002 `drop-to-import-pipeline`). Pure main-thread
// orchestration: File → ArrayBuffer → worker dispatch → sink. The worker and the
// clock are injected, so vitest drives the whole thing — including the
// re-drop-while-parsing race — against a stub, and the picker input is the only
// browser-specific seam left to Playwright (ADR-0005).

/** Minimal structural view of a browser Worker — a stub satisfies it in tests. */
export interface ImportWorkerLike {
  onmessage: ((event: MessageEvent<ImportResult>) => void) | null
  postMessage(message: ImportRequest, transfer: Transferable[]): void
  terminate(): void
}

/** Minimal structural view of a File — `{name,size,arrayBuffer()}` in tests. */
export interface ImportFile {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface ImportPipeline {
  importFile(file: ImportFile): Promise<void>
  dispose(): void
}

type Clock = () => number

const EXTENSION_KINDS: ReadonlyArray<[string, ImportKind]> = [
  ['.step', 'step'],
  ['.stp', 'step'],
  ['.stl', 'stl']
]

export function importKindFor(fileName: string): ImportKind | null {
  const lower = fileName.toLowerCase()
  for (const [ext, kind] of EXTENSION_KINDS) {
    if (lower.endsWith(ext)) return kind
  }
  return null
}

function statsFor(parts: ImportedPart[], elapsedMs: number): ImportStats {
  let triangleCount = 0
  for (const part of parts) triangleCount += part.indices.length / 3
  return { elapsedMs, partCount: parts.length, triangleCount }
}

export function createImportPipeline(
  worker: ImportWorkerLike,
  sink: ImportSink,
  now: Clock = () => performance.now()
): ImportPipeline {
  // Monotonic request id. Only the response whose id equals `latestId` is
  // accepted; any earlier in-flight parse that lands afterwards is stale and
  // dropped — this is how a re-drop supersedes the previous file.
  let latestId = 0
  const startedAt = new Map<number, number>()

  worker.onmessage = (event) => {
    const result = event.data
    const t0 = startedAt.get(result.id)
    startedAt.delete(result.id)
    if (result.id !== latestId) return // superseded by a newer drop
    if (result.ok) {
      sink.succeed(result.parts, statsFor(result.parts, t0 === undefined ? 0 : now() - t0))
    } else {
      sink.fail(result.error)
    }
  }

  async function importFile(file: ImportFile): Promise<void> {
    const id = ++latestId // claim latest synchronously, before any await
    sink.begin({ name: file.name, sizeBytes: file.size })

    const kind = importKindFor(file.name)
    if (!kind) {
      if (id === latestId) sink.fail(`Unsupported file type: ${file.name}`)
      return
    }

    let bytes: ArrayBuffer
    try {
      bytes = await file.arrayBuffer()
    } catch (err) {
      if (id === latestId) sink.fail(err instanceof Error ? err.message : String(err))
      return
    }
    if (id !== latestId) return // a newer drop arrived while reading the file

    startedAt.set(id, now())
    const request: ImportRequest = { id, kind, bytes, fileName: file.name }
    worker.postMessage(request, requestTransferables(request))
  }

  return { importFile, dispose: () => worker.terminate() }
}
