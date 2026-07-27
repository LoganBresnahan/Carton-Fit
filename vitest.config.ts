import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * 30 s, against vitest's 5 s default, because several tests here are MEANT to
     * take seconds and the default turns that into a lottery.
     *
     * The heavy ones are heavy on purpose: the convex-hull/OBB rotation search on
     * a diagonally rotated rod, the extreme-point backstop's 500-part load (whose
     * whole point is that the budget is REACHABLE — ADR-0022 §6), and the
     * determinism suite re-packing each case three times. They run 1.6–2.0 s on an
     * 8-core dev machine and 5–7 s on CI's 4 vCPUs, so a 5 s bar fails them for the
     * machine they landed on rather than for anything they measured. Found exactly
     * that way: three went red on CI while green locally, two of them untouched
     * code that had been passing at ~4.5 s — the suite was one busy runner away
     * from red before anyone added a test.
     *
     * Chosen to still catch a real hang — a wedged geometry search is unbounded,
     * not 6× slow — while never letting "this runner had spare cores" be the reason
     * a run passes. A test that needs more than this is measuring the wrong thing.
     */
    testTimeout: 30_000
  }
})
