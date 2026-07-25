import { defineConfig } from '@playwright/test'

// Compliance specs (ADR-0011), kept in their own config on purpose.
//
// These tests deliberately CORRUPT the packaged build to prove a licence
// guarantee holds — that a recipient really can substitute their own build of
// the LGPL occt-import-js library. That must never run as part of an ordinary
// `npm run e2e` / `npm run e2e:packaged`, so the specs live outside `e2e/` and
// are reachable only through this config, which the release workflow invokes
// explicitly.
//
// Serial and single-worker for a harder reason than the main suite's: these
// specs mutate a shared file on disk. Any parallelism here would have one spec
// sabotaging another's binary.

export default defineConfig({
  testDir: './e2e-compliance',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries, deliberately. A retry would re-run a test whose first attempt
  // may have left the build tampered, and "flaky" is not a meaningful verdict
  // for a compliance check — it either holds or it does not.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
