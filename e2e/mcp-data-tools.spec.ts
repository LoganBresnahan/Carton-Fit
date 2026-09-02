import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { CUBE_STL, GOLDEN_PACKS } from '../samples/goldens'
import type { AppStateReport } from '../src/main/mcp/appState'
import type { DriveOutcome } from '../src/shared/mcpDrive'
import { SAMPLES } from './harness'
import { appHostedLaunch, appModeEnv, callStructured, connect } from './mcpClient'

/**
 * The v3 DATA tier end to end (ADR-0029, slice `v3-data-tools`).
 *
 * `tests/mcp-data-tools.test.ts` pins the tier's own decisions against a faked
 * database and a faked window. What only a launched app can prove is the thing
 * those fakes stand in for: that a preset saved through the tool is written by
 * better-sqlite3 into a real file, read back by main's own connection, and —
 * when applied — re-packs through the store, the debounce and the worker to a
 * number the goldens predict.
 *
 * The applied-preset assertion is the one that earns this file its place. A
 * preset that saved but did not restore, or restored without re-estimating,
 * would pass every unit test in this repo: the count only changes if the whole
 * chain ran.
 *
 * PACKAGED ONLY, like `storage.spec.ts` and `native-module.spec.ts`:
 * better-sqlite3 is compiled for whichever ABI packaged last and `npm test`
 * restores the Node one (ADR-0013), so in a dev run main legitimately reports
 * storage unavailable and every tool here answers with that.
 */
test.describe('the data tier against a real database', () => {
  test.skip(
    !process.env.PACKAGED_APP,
    'needs the Electron-ABI build of better-sqlite3, which only a packaged build reliably has'
  )

  type Outcome = { state: AppStateReport; estimate: DriveOutcome['estimate'] }

  function goldenNamed(name: string): (typeof GOLDEN_PACKS)[number] {
    const golden = GOLDEN_PACKS.find((pack) => pack.name === name)
    if (!golden) throw new Error(`golden scenario missing: ${name}`)
    return golden
  }

  /** Set the carton to a golden scenario and return the count that came back. */
  async function packInto(client: Client, name: string): Promise<number> {
    const golden = goldenNamed(name)
    const outcome = await callStructured<Outcome>(client, 'set_inputs', {
      mode: golden.mode,
      tier: golden.tier,
      carton: {
        dimensions: {
          x: golden.cartonIn[0],
          y: golden.cartonIn[1],
          z: golden.cartonIn[2],
          unit: 'in'
        },
        measured: 'inner'
      }
    })
    expect(outcome.estimate.available, 'expected an estimate in the reply').toBe(true)
    if (!outcome.estimate.available) throw new Error('unreachable')
    const result = outcome.estimate.report.outcome
    if (result.mode !== 'max-quantity') throw new Error('expected a max-quantity answer')
    return result.count
  }

  test('a preset journey: save what is on screen, change it, get it back', async () => {
    test.setTimeout(180_000)
    const client = await connect(appHostedLaunch(), appModeEnv())
    try {
      // Nothing yet — an empty database is an empty list, not an error. The
      // distinction matters: "presets are broken" and "you have no presets"
      // must not look the same to a client (ADR-0007).
      const empty = await callStructured<{ presets: unknown[] }>(client, 'list_presets', {})
      expect(empty.presets).toEqual([])

      await callStructured<Outcome>(client, 'load_model', {
        path: join(SAMPLES, CUBE_STL.file)
      })

      const big = goldenNamed('cube max-quantity in a 12 in carton')
      expect(await packInto(client, big.name)).toBe(big.count)

      // Saves the app's CURRENT inputs — the tool carries only a name.
      const afterSave = await callStructured<{ presets: Array<{ name: string; savedAt: string }> }>(
        client,
        'save_preset',
        { name: 'twelve inch' }
      )
      expect(afterSave.presets.map((preset) => preset.name)).toEqual(['twelve inch'])
      // A real timestamp from a real row, not a placeholder.
      expect(Date.parse(afterSave.presets[0]?.savedAt ?? '')).toBeGreaterThan(0)

      // Move the app somewhere else entirely, and confirm it went.
      const small = goldenNamed('cube max-quantity in a 3 in carton (slack on the far faces)')
      expect(await packInto(client, small.name)).toBe(small.count)

      // THE ASSERTION THIS FILE EXISTS FOR. Applying the preset must reach the
      // database, the store, the debounce and the worker — and the reply must
      // already carry the re-estimated count, not the one on screen when the
      // call arrived. 27,000 and 343 are far enough apart that a stale answer
      // cannot pass by luck.
      const applied = await callStructured<Outcome>(client, 'apply_preset', {
        name: 'twelve inch'
      })
      expect(applied.estimate.available).toBe(true)
      if (!applied.estimate.available) throw new Error('unreachable')
      expect(applied.estimate.report.outcome).toMatchObject({ count: big.count })

      // A preset that does not exist says so rather than silently doing nothing.
      const missing = await client.callTool({
        name: 'apply_preset',
        arguments: { name: 'no such preset' }
      })
      expect(missing.isError).toBe(true)
    } finally {
      await client.close()
    }
  })

  test('an estimate journey: save a receipt, restore its inputs, export the answer', async () => {
    test.setTimeout(180_000)
    const client = await connect(appHostedLaunch(), appModeEnv())
    try {
      // Saving before there is anything to save must refuse WITH A REASON —
      // the renderer's own guard returns a quiet false, which is right for a
      // disabled button and wrong on a wire where "no error" reads as "saved".
      const tooEarly = await client.callTool({ name: 'save_estimate', arguments: {} })
      expect(tooEarly.isError).toBe(true)

      await callStructured<Outcome>(client, 'load_model', {
        path: join(SAMPLES, CUBE_STL.file)
      })
      const big = goldenNamed('cube max-quantity in a 12 in carton')
      const bigCount = await packInto(client, big.name)
      expect(bigCount).toBe(big.count)

      const saved = await callStructured<{
        estimates: Array<{ id: number; file: string; summary: string }>
      }>(client, 'save_estimate', {})
      expect(saved.estimates).toHaveLength(1)
      const row = saved.estimates[0]
      if (!row) throw new Error('unreachable')
      expect(row.file).toBe(CUBE_STL.file)
      // The same one-line receipt the app's own list renders (ADR-0016), so
      // what Claude reads out and what the person sees are one sentence.
      expect(row.summary).toContain(bigCount.toLocaleString('en-US'))

      // Move away, then restore the row's INPUTS — never its stored answer
      // (ADR-0016 §3). What comes back is the engine computing again, which is
      // why the count has to reappear rather than be replayed.
      const small = goldenNamed('cube max-quantity in a 3 in carton (slack on the far faces)')
      expect(await packInto(client, small.name)).toBe(small.count)

      const restored = await callStructured<Outcome>(client, 'restore_estimate', { id: row.id })
      expect(restored.estimate.available).toBe(true)
      if (!restored.estimate.available) throw new Error('unreachable')
      expect(restored.estimate.report.outcome).toMatchObject({ count: big.count })

      // Both exports, returned as text with nothing written to disk.
      const summary = await callStructured<{ text: string; suggestedName: string }>(
        client,
        'export_estimate',
        { format: 'summary' }
      )
      expect(summary.text).toContain('Carton Fit — estimate')
      expect(summary.text).toContain(bigCount.toLocaleString('en-US'))
      expect(summary.suggestedName).toMatch(/\.txt$/)

      const csv = await callStructured<{ text: string; suggestedName: string }>(
        client,
        'export_estimate',
        { format: 'csv' }
      )
      // A header row and at least one part row — the measurements table, not
      // an empty file with a plausible name.
      expect(csv.text.split('\n').length).toBeGreaterThan(1)
      expect(csv.suggestedName).toMatch(/\.csv$/)

      const unknown = await client.callTool({
        name: 'restore_estimate',
        arguments: { id: 99_999 }
      })
      expect(unknown.isError).toBe(true)
    } finally {
      await client.close()
    }
  })
})
