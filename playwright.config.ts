import { defineConfig } from '@playwright/test'

// Playwright-Electron config (ADR-0005 layer 2, roadmap item 6).
//
// No `projects`/browsers: these specs never open a browser. They launch OUR
// Electron binary via `_electron.launch()`, so the usual browser download is
// skipped entirely (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 at install time).
//
// Written CI-ready from day one (ADR-0005 display consequences), because
// retrofitting that later is a rewrite:
//   - No fixed-size display is assumed. Locally WSLg supplies one; a GitHub
//     Linux runner does not, so ci.yml wraps this in `xvfb-run -a` and nothing
//     here may depend on a particular screen geometry. Window size is set
//     per-launch instead. (Windows runners have a real desktop session and need
//     no wrapper — release.yml runs this suite there directly.)
//   - Workers are pinned to 1. Each spec drives a real Electron process holding
//     a GL context, and Chromium caps contexts (~16); parallel workers on a
//     software rasterizer contend for CPU and produce timing flakes, which is
//     exactly what the ship bar's "green twice" rule is meant to expose.
//   - Retries are 0 locally. A flaky e2e here is a real defect (worker timing,
//     debounce, GL) and must not be papered over; CI gets 1 retry only so an
//     infrastructure blip doesn't fail a release.
//
// The SwiftShader flags live in e2e/harness.ts, not here, so they stay attached
// to the launch that needs them — and, per VISION, never leak into shipped code.

export default defineConfig({
  testDir: './e2e',
  // Electron start-up (~1 s) plus a WASM STEP parse plus the 180 ms pack
  // debounce; generous so a loaded machine doesn't fail on latency alone.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
