import { createImportPipeline, type ImportFile } from './pipeline'
import { storeImportSink } from '../store'

// App-lifetime wiring (ADR-0006 spine): one persistent import worker + pipeline,
// created once and driven by the store sink. A single long-lived worker keeps
// occt's ~11 MB WASM warm across imports (loadOcct memoizes it), so repeat
// parses skip re-initialization; a re-drop mid-parse is handled by the
// pipeline's id-staleness filter, not by tearing the worker down.
//
// Note: because occt's ReadStepFile is synchronous inside the worker, a second
// drop queues behind an in-flight parse rather than pre-empting it. Acceptable
// for v1 (parses are sub-second); revisit alongside ADR-0002's import-time trigger.

function createImportWorker(): Worker {
  return new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
    type: 'module'
  })
}

const pipeline = createImportPipeline(createImportWorker(), storeImportSink())

/** Kick off an import of a picked/dropped file. Fire-and-forget: outcomes land
 *  in the store via the sink. */
export function importFile(file: ImportFile): Promise<void> {
  return pipeline.importFile(file)
}
