import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { ingestStepFile, readModel, resetOcctForTests } from '../src/main/occt/ingest'
import {
  occtAssetsDir,
  resolveOcctWasm,
  type OcctWasmContext,
  type WasmLookup
} from '../src/main/occt/wasmPath'
import { aabbSize, computeAabb, isClosedMesh, meshVolume } from '../src/renderer/src/core/geometry'

// The main-process STEP path (ADR-0029 phase 1). Two things need proving and
// they are different in kind:
//
//   1. the pipeline — a path on disk becomes the same protocol parts the
//      renderer's worker produces, checked against the SAME hand-computed
//      goldens tests/golden-parse.test.ts uses. Not a snapshot of our own
//      output: a 10 mm cube is 1000 mm³ by arithmetic, and AS1 is 18 solids by
//      inspection of the product.
//   2. the wasm lookup — which is really a compliance question (ADR-0011), and
//      cannot be answered here, because a packaged layout does not exist in the
//      source tree. So the lookup is tested against an INJECTED filesystem for
//      its packaged branch, and the real end-to-end packaged run is the manual
//      gate recorded in doc/plans/adr-0029-mcp-build-plan.md.

const REPO_ROOT = join(__dirname, '..')
const SAMPLES = join(REPO_ROOT, 'samples')
const SOURCE_TREE: OcctWasmContext = { appPath: REPO_ROOT, isPackaged: false }

afterEach(() => {
  resetOcctForTests()
})

describe('ingestStepFile', () => {
  it('reads the cube golden off disk as one closed 10 mm cube of 1000 mm³', async () => {
    const parts = await ingestStepFile(join(SAMPLES, 'cube-10x10.stp'), SOURCE_TREE)
    expect(parts).toHaveLength(1)
    const [part] = parts
    const size = aabbSize(computeAabb(part.positions))
    expect(size[0]).toBeCloseTo(10, 3)
    expect(size[1]).toBeCloseTo(10, 3)
    expect(size[2]).toBeCloseTo(10, 3)
    expect(meshVolume(part.positions, part.indices)).toBeCloseTo(1000, 3)
    expect(isClosedMesh(part.positions, part.indices)).toBe(true)
  })

  it('extracts AS1’s 18 solids, instance-named', async () => {
    const parts = await ingestStepFile(join(SAMPLES, 'as1-oc-214.stp'), SOURCE_TREE)
    expect(parts).toHaveLength(18) // 1 plate + 2 brackets + 1 rod + 6 bolts + 8 nuts
    // Duplicate products get ordinal suffixes rather than colliding — the naming
    // an AI client will read back as part identity, so it has to survive here.
    expect(new Set(parts.map((p) => p.name)).size).toBe(18)
  })

  it('names the file it could not read', async () => {
    await expect(ingestStepFile(join(SAMPLES, 'no-such-part.stp'), SOURCE_TREE)).rejects.toThrow(
      /could not read .*no-such-part\.stp/
    )
  })

  it('reports an unparseable STEP file rather than returning nothing', async () => {
    // A real file with real bytes that are not STEP: the failure mode that must
    // not read as "this part has no geometry".
    await expect(ingestStepFile(join(SAMPLES, 'cube-10x10.stl'), SOURCE_TREE)).rejects.toThrow(
      /OpenCascade could not read/
    )
  })
})

describe('readModel dispatch', () => {
  it('accepts .step and .stp, case-insensitively', async () => {
    await expect(readModel(join(SAMPLES, 'cube-10x10.stp'), SOURCE_TREE)).resolves.toHaveLength(1)
  })

  it('turns STL away with a reason, not a parse failure', async () => {
    // Phase 2 decides whether main gets an STL reader (it needs three, which
    // packaging prunes). Until then the answer must say what to do instead.
    await expect(readModel(join(SAMPLES, 'cube-10x10.stl'), SOURCE_TREE)).rejects.toThrow(
      /not readable from this interface yet/
    )
  })

  it('rejects a file it does not read at all', async () => {
    await expect(readModel(join(SAMPLES, 'goldens.ts'), SOURCE_TREE)).rejects.toThrow(
      /not a model file/
    )
  })
})

describe('resolveOcctWasm', () => {
  const packaged: OcctWasmContext = {
    appPath: '/opt/Carton-Fit/resources/app.asar',
    isPackaged: true
  }

  function lookupOf(files: Record<string, string[]>, present: string[] = []): WasmLookup {
    return {
      listWasm: (dir) => files[dir] ?? [],
      exists: (file) => present.includes(file)
    }
  }

  it('looks beside app.asar, not inside it — that is where asarUnpack puts it', () => {
    expect(occtAssetsDir(packaged)).toBe(
      '/opt/Carton-Fit/resources/app.asar.unpacked/out/renderer/assets'
    )
  })

  it('finds the hashed asset the renderer also loads', () => {
    const assets = occtAssetsDir(packaged)
    const lookup = lookupOf({ [assets]: ['occt-import-js-BhHfLpto.wasm'] })
    expect(resolveOcctWasm(packaged, lookup)).toBe(join(assets, 'occt-import-js-BhHfLpto.wasm'))
  })

  it('never falls back to node_modules when packaged', () => {
    // The load-bearing assertion of this file. A fallback here would let the
    // main process keep using a private copy after a recipient replaced the
    // shipped .wasm with their own build — ADR-0011's guarantee, silently false
    // for half the app. Absent is an error, not a cue to look elsewhere.
    const devCopy = '/opt/Carton-Fit/resources/app.asar/node_modules/occt-import-js/dist/occt-import-js.wasm'
    const lookup = lookupOf({}, [devCopy])
    expect(() => resolveOcctWasm(packaged, lookup)).toThrow(/packaged build is incomplete/)
  })

  it('falls back to node_modules only in a source tree, where out/ may not exist', () => {
    // `electron-vite dev` serves the renderer from memory; out/renderer/assets
    // is simply not on disk, and this is the copy vitest itself uses.
    const devCopy = join(REPO_ROOT, 'node_modules', 'occt-import-js', 'dist', 'occt-import-js.wasm')
    const lookup = lookupOf({}, [devCopy])
    expect(resolveOcctWasm(SOURCE_TREE, lookup)).toBe(devCopy)
  })

  it('refuses to guess between two wasm files', () => {
    const assets = occtAssetsDir(packaged)
    const lookup = lookupOf({ [assets]: ['occt-import-js-aaa.wasm', 'occt-import-js-bbb.wasm'] })
    expect(() => resolveOcctWasm(packaged, lookup)).toThrow(/found 2/)
  })

  it('says where it looked when there is nothing anywhere', () => {
    expect(() => resolveOcctWasm(SOURCE_TREE, lookupOf({}))).toThrow(/npm run build/)
  })
})
