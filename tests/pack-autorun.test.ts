import { describe, expect, it, vi } from 'vitest'
import { createAutoPack, type AutoPackTimer } from '../src/renderer/src/packing/autoPack'
import { useAppStore, type PackingSettings } from '../src/renderer/src/store'
import type { PackRequest } from '../src/renderer/src/core/packing/types'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'

// The auto-runner coalesces input changes into one pack. The timer is injected,
// so these tests drive the coalescing deterministically — no fake clock, no
// waiting.

/** Manual scheduler: nothing runs until the test says so. */
function manualTimer(): AutoPackTimer & {
  runPending(): void
  pendingCount: number
  cancelled: unknown[]
} {
  const jobs = new Map<unknown, () => void>()
  let nextHandle = 1
  const cancelled: unknown[] = []
  return {
    schedule: (fn: () => void) => {
      const handle = nextHandle++
      jobs.set(handle, fn)
      return handle
    },
    cancel: (handle: unknown) => {
      cancelled.push(handle)
      jobs.delete(handle)
    },
    runPending() {
      const pending = [...jobs.values()]
      jobs.clear()
      for (const job of pending) job()
    },
    get pendingCount() {
      return jobs.size
    },
    cancelled
  }
}

function part(name = 'p'): ImportedPart {
  return {
    name,
    positions: new Float32Array([0, 0, 0, 10, 10, 10]),
    normals: null,
    indices: new Uint32Array([0, 1, 0])
  }
}

function settings(patch: Partial<PackingSettings> = {}): PackingSettings {
  return { ...useAppStore.getState().settings, ...patch }
}

describe('createAutoPack', () => {
  it('coalesces a burst of changes into a single dispatch of the LAST inputs', () => {
    const timer = manualTimer()
    const dispatch = vi.fn<(r: PackRequest) => void>()
    const auto = createAutoPack(dispatch, { timer })

    // Typing "1", then "12", then "120" into a carton dimension.
    auto.changed([part()], settings({ boxDimsMm: [1, 100, 100] }))
    auto.changed([part()], settings({ boxDimsMm: [12, 100, 100] }))
    auto.changed([part()], settings({ boxDimsMm: [120, 100, 100] }))
    expect(dispatch).not.toHaveBeenCalled() // nothing dispatched mid-burst
    expect(timer.cancelled).toHaveLength(2) // each keystroke cancelled the last

    timer.runPending()
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0][0].carton).toEqual([120, 100, 100])
  })

  it('does not dispatch when there is nothing to pack', () => {
    const timer = manualTimer()
    const dispatch = vi.fn()
    createAutoPack(dispatch, { timer }).changed([], settings())

    timer.runPending()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches again on a later change', () => {
    const timer = manualTimer()
    const dispatch = vi.fn<(r: PackRequest) => void>()
    const auto = createAutoPack(dispatch, { timer })

    auto.changed([part()], settings({ tier: 'fast' }))
    timer.runPending()
    auto.changed([part()], settings({ tier: 'thorough' }))
    timer.runPending()

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls[1][0].tier).toBe('thorough')
  })

  it('cancels a pending pack on dispose', () => {
    const timer = manualTimer()
    const dispatch = vi.fn()
    const auto = createAutoPack(dispatch, { timer })

    auto.changed([part()], settings())
    auto.dispose()
    timer.runPending()

    expect(timer.pendingCount).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
