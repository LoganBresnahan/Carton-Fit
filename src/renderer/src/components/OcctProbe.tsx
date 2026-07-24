import { useEffect, useState } from 'react'
import type { OcctProbeResult } from '../workers/occt/occt-probe.worker'

// Phase-1 scaffolding (ADR-0002 `occt-wasm-dependency`): renders a visible,
// testable signal that the OpenCascade WASM loaded in a worker. Removed when
// phase 2's real import worker + parts list replaces it.
type Status = 'loading' | 'ready' | 'failed'

export default function OcctProbe() {
  const [status, setStatus] = useState<Status>('loading')
  const [detail, setDetail] = useState<string>('')

  useEffect(() => {
    const worker = new Worker(new URL('../workers/occt/occt-probe.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<OcctProbeResult>) => {
      const r = e.data
      if (r.ready && r.hasReadStep) {
        setStatus('ready')
      } else {
        setStatus('failed')
        setDetail(r.error ?? 'module loaded but ReadStepFile is missing')
      }
    }
    worker.onerror = (e) => {
      setStatus('failed')
      setDetail(e.message)
    }
    worker.postMessage('probe')
    return () => worker.terminate()
  }, [])

  const label =
    status === 'loading'
      ? 'Loading STEP engine…'
      : status === 'ready'
        ? 'STEP engine ready'
        : `STEP engine failed: ${detail}`

  return (
    <p className={`occt-status occt-status-${status}`} data-testid="occt-status" data-status={status}>
      {label}
    </p>
  )
}
