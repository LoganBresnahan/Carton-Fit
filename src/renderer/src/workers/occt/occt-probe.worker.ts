// Phase-1 proof harness for ADR-0002's `occt-wasm-dependency` slice: it exists
// only to prove the WASM binary instantiates inside a module worker in every
// runtime context (dev http, packaged file://). Phase 2's `step-import-worker`
// reuses loadOcct() and supersedes this file — delete it then.
import { loadOcct } from './loadOcct'

export interface OcctProbeResult {
  ready: boolean
  /** Confirms the instantiated module exposes the STEP entry point. */
  hasReadStep?: boolean
  error?: string
}

self.onmessage = async () => {
  let result: OcctProbeResult
  try {
    const occt = await loadOcct()
    result = { ready: true, hasReadStep: typeof occt.ReadStepFile === 'function' }
  } catch (err) {
    result = { ready: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(result)
}
