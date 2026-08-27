import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The persistence ROUND TRIP for the panel width, which needs a `localStorage`
// this suite does not have: vitest runs in node (no jsdom), and store.ts reads
// storage at module load. So the fake is installed on globalThis FIRST and the
// store is imported dynamically inside each test — vitest isolates modules per
// file, so this file gets its own registry and cannot disturb the other suites
// that import the store normally.
//
// `panelWidthFromStored` covers what a stored value MEANS (panel-layout-store);
// what this file covers is that a write happens at all, which is the half a
// pure-function test structurally cannot see.

interface FakeStorage {
  store: Map<string, string>
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
}

function fakeStorage(seed: Record<string, string> = {}): FakeStorage {
  const store = new Map(Object.entries(seed))
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v)
  }
}

const LAYOUT_KEY = 'carton-fit:layout'

function install(storage: unknown, innerWidth = 2560): void {
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { innerWidth })
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/renderer/src/store')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('panel width persistence', () => {
  it('writes the width to its own key when it changes', async () => {
    const storage = fakeStorage()
    install(storage)
    const { useAppStore } = await freshStore()

    useAppStore.getState().setPanelWidth(500)

    expect(storage.store.get(LAYOUT_KEY)).toBe(JSON.stringify({ panelWidth: 500 }))
  })

  it('leaves the settings key alone when only the width changes', async () => {
    // The whole point of a separate key (ADR-0026 §6): a width must not touch
    // the blob that presets and saved estimates serialize.
    const storage = fakeStorage()
    install(storage)
    const { useAppStore } = await freshStore()

    useAppStore.getState().setPanelWidth(420)

    expect(storage.store.has('carton-fit:settings')).toBe(false)
  })

  it('reads a persisted width back at store init, before any frame', async () => {
    const storage = fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ panelWidth: 500 }) })
    install(storage)
    const { useAppStore } = await freshStore()

    // Not "after an effect" — the value is already right at first read.
    expect(useAppStore.getState().panelWidth).toBe(500)
  })

  it('round-trips: a width written by one session is what the next one opens with', async () => {
    const storage = fakeStorage()
    install(storage)
    const first = await freshStore()
    first.useAppStore.getState().setPanelWidth(480)

    // A second "launch" against the same storage.
    install(storage)
    const second = await freshStore()

    expect(second.useAppStore.getState().panelWidth).toBe(480)
  })

  it('clamps a width stored on a wider monitor against THIS window', async () => {
    const storage = fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ panelWidth: 620 }) })
    install(storage, 1000) // half is 500
    const { useAppStore } = await freshStore()

    expect(useAppStore.getState().panelWidth).toBe(500)
  })

  it('opens at the default when storage throws', async () => {
    // A private-mode / disabled-storage browser throws on access rather than
    // returning null. The app must still open.
    install({
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      }
    })
    const { useAppStore } = await freshStore()

    expect(useAppStore.getState().panelWidth).toBe(360)
    // ...and a write that cannot land must not take the app down with it.
    expect(() => useAppStore.getState().setPanelWidth(500)).not.toThrow()
    expect(useAppStore.getState().panelWidth).toBe(500)
  })
})
