import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Shared e2e harness (ADR-0005 layer 2). Everything WSL- or GPU-specific lives
// here and nowhere else — per VISION, the shipped app carries zero GL flags,
// because on the Windows target ANGLE→D3D11 works out of the box.

export const REPO_ROOT = join(__dirname, '..')
export const SAMPLES = join(REPO_ROOT, 'samples')

/**
 * Software rendering, mandatory on WSL2 and CI.
 *
 * Without these, WebGL context creation fails outright — the viewport falls
 * back to "3D preview unavailable" and every packed-view assertion becomes
 * vacuous rather than failing loudly. Observed on WSL2: llvmpipe dies with
 * `BindToCurrentSequence failed`.
 */
const SOFTWARE_GL = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist'
]

/**
 * What to launch.
 *
 * `PACKAGED_APP` points at a packaged binary — that is what `/deploy` sets, and
 * ADR-0005 is explicit that dev-mode green does not count, because packaged
 * builds fail in packaged-only ways (asset paths, WASM loading, workers).
 * Without it we run the electron-vite output through the Electron dev binary,
 * which is still the production renderer bundle over `file://`, so these specs
 * are useful before an installer exists.
 */
export function launchTarget(): { executablePath?: string; args: string[] } {
  const packaged = process.env.PACKAGED_APP
  if (packaged) {
    if (!existsSync(packaged)) {
      throw new Error(
        `PACKAGED_APP=${packaged} does not exist — build it first ` +
          `(npm run build && npx electron-builder --linux dir)`
      )
    }
    return { executablePath: packaged, args: [...SOFTWARE_GL] }
  }
  const main = join(REPO_ROOT, 'out', 'main', 'index.js')
  if (!existsSync(main)) {
    throw new Error(`${main} missing — run \`npm run build\` first`)
  }
  return { args: [main, ...SOFTWARE_GL] }
}

export interface AppHandle {
  app: ElectronApplication
  page: Page
}

/** Launch the app and wait for the first window to be interactive. */
export async function launchApp(): Promise<AppHandle> {
  const target = launchTarget()
  // VSCode terminals export ELECTRON_RUN_AS_NODE=1, which makes the Electron
  // binary behave as plain Node and the launch hang with no window. Strip it for
  // the child regardless of how the suite was started.
  //
  // DELETE the key — do not set it to ''. Electron tests for the variable's
  // PRESENCE, not its truthiness, so an empty string still triggers node mode on
  // Windows (it happens to be tolerated on Linux). The symptom is the Electron
  // binary rejecting Chromium's own switches: `bad option:
  // --remote-debugging-port=0`. Found by running this suite on windows-latest,
  // which is the reason ADR-0012 puts e2e on the Windows runner at all.
  const childEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') childEnv[key] = value
  }

  const app = await electron.launch({
    executablePath: target.executablePath,
    args: target.args,
    env: childEnv
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="dropzone"]')
  // Settings persist to localStorage; start every spec from documented defaults
  // so one spec's carton cannot leak into the next.
  await page.evaluate(() => localStorage.removeItem('packaging-estimator:settings'))
  await page.reload()
  await page.waitForSelector('[data-testid="dropzone"]')
  return { app, page }
}

/**
 * Load a sample through the FILE PICKER.
 *
 * ADR-0005: OS-level drag-and-drop cannot be simulated, so e2e goes through the
 * picker — which is why DropZone must keep that path (also an accessibility
 * win). This is the one seam the app maintains for testability.
 */
export async function importSample(page: Page, fileName: string): Promise<void> {
  await page.setInputFiles('[data-testid="file-input"]', join(SAMPLES, fileName))
  // Import lands in the store, then the debounced pack follows.
  await page.waitForSelector('[data-testid="import-stats"]', { timeout: 30_000 })
}

/** Type a value into a number field, committing it the way React sees it. */
export async function setField(page: Page, testId: string, value: number): Promise<void> {
  const field = page.locator(`[data-testid="${testId}"]`)
  await field.fill(String(value))
}

/** Set all three carton dimensions (in the UI's current display unit). */
export async function setCarton(
  page: Page,
  [l, w, h]: readonly [number, number, number]
): Promise<void> {
  await setField(page, 'dim-0', l)
  await setField(page, 'dim-1', w)
  await setField(page, 'dim-2', h)
}

/**
 * Wait for the estimate to settle on the CURRENT inputs.
 *
 * Auto-run is debounced (ADR-0009), so a naive read races the pack that the
 * last keystroke queued. Waiting for status to leave 'packing' is not enough
 * either — the debounce means the pack may not have STARTED yet. So: settle on
 * a done status that stays done across the debounce window.
 */
export async function waitForEstimate(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="results-panel"]')
  await panel.waitFor({ timeout: 30_000 })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="results-panel"]')
      return el instanceof HTMLElement && el.dataset.status === 'done'
    },
    undefined,
    { timeout: 30_000 }
  )
  // Outlast the 180 ms debounce, then confirm nothing new started.
  await page.waitForTimeout(400)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="results-panel"]')
      return el instanceof HTMLElement && el.dataset.status === 'done'
    },
    undefined,
    { timeout: 30_000 }
  )
}

/** Everything the results panel is showing, as the user sees it. */
export async function readEstimate(page: Page): Promise<{
  headline: string
  caption: string
  binding: string
  fill: string
  tier: string
  weight: string | null
  truncated: string | null
  unplaced: string | null
}> {
  return page.evaluate(() => {
    const text = (id: string): string | null => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      return el ? (el.textContent ?? '').trim() : null
    }
    return {
      headline: text('results-headline') ?? '',
      caption: text('results-caption') ?? '',
      binding: text('results-binding') ?? '',
      fill: text('results-utilization') ?? '',
      tier: text('results-tier') ?? '',
      weight: text('results-weight'),
      truncated: text('results-truncated'),
      unplaced: text('results-unplaced')
    }
  })
}
