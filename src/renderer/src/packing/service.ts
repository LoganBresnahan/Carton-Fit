import { createPackPipeline } from './pipeline'
import { createAutoPack } from './autoPack'
import { storePackSink, useAppStore } from '../store'

// App-lifetime wiring (ADR-0006 spine): one persistent pack worker + pipeline,
// driven by a store subscription. Mirrors import/service.ts, with one structural
// difference — imports are triggered by a user gesture (a component calls
// importFile), whereas a pack is triggered by STATE: any change to the imported
// parts or the packing settings re-runs the estimate. So the trigger lives here,
// as a subscription, and no component ever calls the packer.
//
// A long-lived worker keeps the module (and any warm JIT) alive across runs; a
// superseded in-flight pack is handled by the pipeline's id-staleness filter,
// not by tearing the worker down.

function createPackWorker(): Worker {
  return new Worker(new URL('../workers/pack.worker.ts', import.meta.url), {
    type: 'module'
  })
}

let started = false

/** Install the auto-pack subscription. Called once from the renderer entry;
 *  idempotent so StrictMode double-invocation can't double-subscribe. */
export function startAutoPack(): () => void {
  if (started) return () => {}
  started = true

  const pipeline = createPackPipeline(createPackWorker(), storePackSink())
  const autoPack = createAutoPack((request) => pipeline.requestPack(request))

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    // Only the inputs that define an estimate. Pack-state writes must NOT
    // re-trigger — that would be an infinite loop.
    if (
      state.parts !== prev.parts ||
      state.settings !== prev.settings ||
      state.unitPartName !== prev.unitPartName
    ) {
      autoPack.changed(state.parts, state.settings, state.unitPartName)
    }
  })

  return () => {
    unsubscribe()
    autoPack.dispose()
    pipeline.dispose()
    started = false
  }
}
