import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../src/renderer/src/store'
import { collectExport } from '../src/renderer/src/export/collect'
import type { ImportedPart } from '../src/renderer/src/workers/import-protocol'
import type { PackRequest, PackResult } from '../src/renderer/src/core/packing/types'

// What the export is assembled FROM (ADR-0017 §2 / ADR-0018 §4).
//
// The builders are pinned in export-builders.test.ts against hand-made inputs;
// this file covers the step before them, which is where a real bug lived:
// `collectExport` computed its warnings without passing the per-kind overrides,
// so every export carried "not a closed mesh, the weight is unreliable" for
// kinds the user had already priced by hand. Nothing caught it, because the
// panel's own call site WAS correct and the two were only compared by eye.
//
// The parameter is required now, so this class of omission is a type error
// rather than a test's responsibility. The tests remain because the requirement
// they encode — warnings describe the estimate as it currently stands — is
// about behaviour, not about the signature that happens to enforce it today.

/** A 10 mm cube missing its +z face: perfect bbox, volume 33% light. */
function openCube(name: string): ImportedPart {
  const s = 10
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7]
  ]
  return {
    name,
    positions: new Float32Array(v.flat()),
    normals: null,
    indices: new Uint32Array(faces.flat())
  }
}

const RESULT: PackResult = {
  mode: 'fit-check',
  tier: 'fast',
  fits: true,
  unplaced: [],
  placements: [],
  binding: 'geometry',
  heuristic: true,
  utilization: 0.1
}

const REQUEST: PackRequest = {
  mode: 'fit-check',
  tier: 'fast',
  carton: [100, 100, 100],
  clearances: { betweenParts: 0, wall: 0 },
  maxWeightG: 1000,
  parts: []
}

function loadOpenParts(names: string[]): void {
  const state = useAppStore.getState()
  state.importSucceeded(
    names.map(openCube),
    { elapsedMs: 1, partCount: names.length, triangleCount: 10 },
    'hash'
  )
  state.updateSettings({ weightMode: 'density', densityGPerCm3: 1 })
  state.packSucceeded(RESULT, REQUEST, 5)
}

beforeEach(() => {
  useAppStore.getState().resetImport()
  useAppStore.getState().updateSettings({ weightMode: 'direct' })
})

describe('collectExport', () => {
  it('returns null unless the estimate on screen is current', () => {
    expect(collectExport()).toBeNull()
  })

  it('carries the open-mesh warning when the weight still rests on volume', () => {
    loadOpenParts(['shell', 'cover'])
    // Plural, because two kinds are open — verdict.ts words it either way.
    expect(collectExport()?.warnings.join(' ')).toContain('are not closed meshes')
  })

  it('drops the warning for kinds the user has priced by hand', () => {
    // The bug: an export insisting a weight is unreliable when the user typed
    // it in themselves — in a document that outlives the window and cannot be
    // argued with.
    loadOpenParts(['shell', 'cover'])
    useAppStore.getState().setPartWeight('shell', 50)
    useAppStore.getState().setPartWeight('cover', 50)
    expect(collectExport()?.warnings).toEqual([])
  })

  it('still warns about the kinds that were NOT overridden', () => {
    loadOpenParts(['shell', 'cover'])
    useAppStore.getState().setPartWeight('shell', 50)
    const warnings = collectExport()?.warnings.join(' ') ?? ''
    expect(warnings).toContain('cover')
    expect(warnings).not.toContain('shell')
  })

  it('covers every instance of an overridden kind', () => {
    loadOpenParts(['shell', 'shell (2)'])
    useAppStore.getState().setPartWeight('shell', 50)
    expect(collectExport()?.warnings).toEqual([])
  })

  it('reports the overrides in play, for the summary to qualify its weight source', () => {
    loadOpenParts(['shell', 'cover'])
    useAppStore.getState().setPartWeight('shell', 50)
    expect(collectExport()?.overrides).toEqual({ shell: 50 })
  })
})
