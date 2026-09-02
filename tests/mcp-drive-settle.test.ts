import { describe, expect, it } from 'vitest'
import {
  createSettleTracker,
  type SettleState,
  type SettleStore
} from '../src/renderer/src/mcp/settle'

// The settle protocol (ADR-0029 v2, slice `v2-drive-tools`) — the slice's
// adversarial-verify target, pinned at the unit layer where the event ORDER
// can be driven exactly. The scenario that matters most is the plan's named
// race: a result larded with 'done' that belongs to the inputs BEFORE a drive
// call's write. A settle that trusts `packStatus === 'done'` alone returns it,
// and the AI client quotes a plausible number for the wrong carton.

function makeStore(): {
  store: SettleStore
  write(patch: Partial<SettleState>): void
} {
  let state: SettleState = {
    parts: [],
    settings: { a: 1 },
    unitPartName: null,
    partWeightsG: {},
    packStatus: 'idle',
    packError: null
  }
  const listeners = new Set<(next: SettleState, prev: SettleState) => void>()
  return {
    store: {
      getState: () => state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    write(patch) {
      const prev = state
      state = { ...state, ...patch }
      for (const listener of listeners) listener(state, prev)
    }
  }
}

/** A microtask flush, so a pending waitForSettle can either resolve or prove
 *  it has not. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('the settle race (the plan’s named failure)', () => {
  it('a stale result landing AFTER an input write does not satisfy the wait', async () => {
    const { store, write } = makeStore()
    const tracker = createSettleTracker(store)
    write({ parts: [{}], packStatus: 'done' }) // a loaded file with an old estimate

    // The drive call writes settings…
    write({ settings: { a: 2 } })

    let outcome: string | null = null
    void tracker.waitForSettle().then((o) => (outcome = o.status))

    // …then the pack that was ALREADY in flight for the old inputs completes.
    // Status says done; the answer belongs to the question before last.
    write({ packStatus: 'done' })
    await flush()
    expect(outcome, 'settle accepted a result computed for the previous inputs').toBeNull()

    // Only a dispatch that BEGAN after the write can carry it (autoPack builds
    // the request from the newest inputs when the debounce fires)…
    write({ packStatus: 'packing' })
    await flush()
    expect(outcome).toBeNull() // began, not finished

    // …and its completion is what settles.
    write({ packStatus: 'done' })
    await flush()
    expect(outcome).toBe('done')
  })

  it('an already-settled state answers immediately', async () => {
    const { store, write } = makeStore()
    const tracker = createSettleTracker(store)
    write({ parts: [{}] })
    write({ packStatus: 'packing' })
    write({ packStatus: 'done' })
    await expect(tracker.waitForSettle()).resolves.toEqual({ status: 'done' })
  })

  it('no parts means nothing will ever dispatch — say so instead of hanging', async () => {
    const { store } = makeStore()
    const tracker = createSettleTracker(store)
    await expect(tracker.waitForSettle()).resolves.toEqual({ status: 'empty' })
  })

  it('a failed pack settles as the failure, message intact', async () => {
    const { store, write } = makeStore()
    const tracker = createSettleTracker(store)
    write({ parts: [{}] })
    write({ settings: { a: 3 } })
    const wait = tracker.waitForSettle()
    write({ packStatus: 'packing' })
    write({ packStatus: 'failed', packError: 'worker exploded' })
    await expect(wait).resolves.toEqual({ status: 'failed', error: 'worker exploded' })
  })

  it('every input slice raises the dirty flag, not just settings', () => {
    const { store, write } = makeStore()
    const tracker = createSettleTracker(store)
    write({ parts: [{}], packStatus: 'done' })
    write({ packStatus: 'packing' })
    write({ packStatus: 'done' })

    expect(tracker.isDirty()).toBe(false)
    write({ unitPartName: 'bolt' })
    expect(tracker.isDirty()).toBe(true)
    write({ packStatus: 'packing' })
    expect(tracker.isDirty()).toBe(false)
    write({ partWeightsG: { bolt: 5 } })
    expect(tracker.isDirty()).toBe(true)
  })
})
