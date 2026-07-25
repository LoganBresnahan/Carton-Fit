import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, REPO_ROOT } from '../e2e/harness'

/**
 * ADR-0011 compliance test: the LGPL relink guarantee is real.
 *
 * occt-import-js is LGPL-2.1, and we publish a specific promise in
 * THIRD-PARTY-NOTICES.md — that a recipient can substitute their own build of
 * the library by overwriting one file, no repack and no rebuild. This test is
 * what makes that promise checkable instead of aspirational.
 *
 * WHY IT LIVES OUTSIDE e2e/
 * It deliberately corrupts the packaged build mid-run. That must never happen
 * during an ordinary `npm run e2e`, so it has its own directory and config and
 * is invoked explicitly by the release workflow.
 *
 * THE TRAP IT IS BUILT TO AVOID
 * The packaged app contains the OCCT wasm TWICE: the live copy that vite emitted
 * (kept outside app.asar by `asarUnpack`) and an unused copy that electron-builder
 * drags in with node_modules (roadmap item 9 carry-in). Tampering with the wrong
 * one leaves the app working, the test green, and the compliance claim false. So
 * this test asserts the substitution actually BREAKS the app — a negative result
 * is the only thing that proves the file is load-bearing.
 *
 * The intact-wasm baseline is not ceremony either: without it, "import failed"
 * could mean the app was broken all along and the test would pass for the wrong
 * reason.
 */

const SAMPLE = 'cube-10x10.stp'

/** The wasm the running app actually loads — outside app.asar, per asarUnpack. */
function liveWasmPath(): string {
  const packaged = process.env.PACKAGED_APP
  if (!packaged) throw new Error('PACKAGED_APP must point at the packaged binary')

  // Walk up from the binary to the app root: win-unpacked/App.exe, or
  // linux-unpacked/binary — both put resources/ beside the executable.
  const appRoot = join(packaged, '..')
  const assets = join(appRoot, 'resources', 'app.asar.unpacked', 'out', 'renderer', 'assets')

  const wasms = readdirSync(assets).filter((f) => f.endsWith('.wasm'))
  if (wasms.length !== 1) {
    throw new Error(
      `expected exactly one unpacked .wasm in ${assets}, found ${wasms.length}: ` +
        `${wasms.join(', ')}. asarUnpack's scope may have changed — ADR-0011.`
    )
  }
  return join(assets, wasms[0])
}

/**
 * Try to import a STEP file; report whether the app produced a result.
 *
 * Import failure surfaces as the stats element never appearing (error states are
 * roadmap item 9), so this bounds the wait rather than using the harness's
 * 30 s success-path timeout.
 */
async function importSucceeds(timeoutMs: number): Promise<boolean> {
  const { app, page } = await launchApp()
  try {
    await page.setInputFiles('[data-testid="file-input"]', join(REPO_ROOT, 'samples', SAMPLE))
    await page.waitForSelector('[data-testid="import-stats"]', { timeout: timeoutMs })
    return true
  } catch {
    return false
  } finally {
    await app.close()
  }
}

const wasm = liveWasmPath()
const original = readFileSync(wasm)

test.afterAll(() => {
  // Restore unconditionally — a failed assertion must not leave a sabotaged
  // build behind for the artifact upload step.
  writeFileSync(wasm, original)
})

test.describe.serial('LGPL relink guarantee (ADR-0011)', () => {
  test('baseline: with the shipped wasm intact, STEP import works', async () => {
    expect(
      await importSucceeds(60_000),
      'the packaged app could not import a golden STEP file even before tampering — ' +
        'the substitution result below would be meaningless'
    ).toBe(true)
  })

  test('substituting the unpacked wasm breaks STEP import', async () => {
    // A valid wasm preamble followed by nothing usable: this is a *substituted*
    // library, not a truncated file, so the failure is OCCT being absent rather
    // than the loader rejecting a non-wasm blob.
    writeFileSync(wasm, Buffer.from('\0asm\x01\0\0\0DELIBERATELY-NOT-OCCT'))

    expect(
      await importSucceeds(45_000),
      'STEP import still worked after replacing the unpacked wasm — the app is NOT ' +
        'loading that file. Either asarUnpack stopped taking effect or an embedded ' +
        'copy is being used, and the LGPL substitution claim in ' +
        'THIRD-PARTY-NOTICES.md is false as written.'
    ).toBe(false)
  })

  test('the build is restored byte-for-byte', async () => {
    writeFileSync(wasm, original)
    expect(readFileSync(wasm).equals(original)).toBe(true)
  })
})
