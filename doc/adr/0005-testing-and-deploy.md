# ADR-0005: Test pyramid (vitest / Playwright-Electron / dogfood) and deploy-to-hands

Date: 2026-07-24
Status: Accepted

## Context

The project is meant to be transferable: another person should be able to pick it up
with Claude Code/Cowork and iterate confidently. That requires (a) machine-verifiable
correctness at every level, not just unit math, and (b) a repeatable way to test each
new iteration as a *user* would. The team's standing practices are dogfooding and
Playwright for automated tests. For a desktop app there is no server to deploy to —
"deploy" must mean something else.

## Decision

Three test layers, each with a distinct job, sharing one set of fixtures:

1. **Unit (vitest)** — the pure math in `core/` (units, geometry, packing, weight
   caps). Fast, exhaustive on edge cases. Runs twice for the ship bar (flaky bar).
2. **E2E (Playwright + Electron)** — `e2e/` specs launch the real app via
   `_electron.launch()`, load a golden sample, enter a golden box spec, and assert the
   known-correct count / orientation / binding constraint, saving screenshots. E2E
   loads files through the picker path — OS-level drag-drop cannot be simulated, so
   the DropZone must always keep a file-picker fallback (also an accessibility win).
3. **Dogfood** — every deploy ends with a human running a *real* part through the new
   build. Machine checks prove golden inputs; dogfooding catches what goldens can't.

**Golden samples** live in `samples/`: small committed STEP/STL parts with
hand-computed expected results (dims, volume, counts for a reference box). They are
the shared fixtures for unit tests, e2e, and manual dogfooding.

**Deploy = build + machine smoke + handoff.** The `/deploy` skill builds installers
from a known commit (Windows NSIS as the ship artifact; `linux-unpacked` from the same
build as the smoke target), runs the Playwright smoke against the *packaged* build
(dev-mode green does not count), stages artifacts with the previous build kept for
rollback, and hands the user a Windows-reachable installer path plus a dogfood script.

## Consequences

- The e2e harness needs a small test seam (stable selectors / picker path); worth it.
- Playwright's Electron driver is officially "experimental" but is the de-facto
  standard since Spectron's deprecation; risk accepted.
- Windows install UX is human-verified on Windows; WSL machine-verifies app behavior
  via the Linux package of the same code. This split is stated, not hidden.
- CI-friendliness comes free: vitest + Playwright both run headless under xvfb later.

## Alternatives considered

- **Spectron / WebdriverIO** for e2e — Spectron is dead; WebdriverIO's Electron
  service is viable but Playwright matches the team's existing practice.
- **Unit tests only** — rejected: the risky seams here (worker messaging, WASM parse,
  UI ↔ engine wiring, packaged-build paths) are exactly what unit tests can't see.

## Revisit triggers

- Playwright's Electron driver breaks against a new Electron major.
- Golden samples drift from real-world parts (dogfooding keeps surfacing bugs goldens
  miss → grow the sample set, or record real parts as new goldens).
- CI lands (GitHub Actions) → wire the same three layers there; deploy grows a tag/
  release step.
