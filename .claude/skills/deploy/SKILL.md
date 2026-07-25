---
name: deploy
description: Build the current packaging-estimator iteration into a runnable artifact and put a verified build in the user's hands. Ship bar first (vitest green twice + typecheck), then electron-builder outputs (a Windows zip as the ship artifact until CI produces the NSIS installer per ADR-0010, plus linux-unpacked from the same build as the smoke target), Playwright smoke against the PACKAGED build using the golden samples, artifacts staged with the previous build kept for rollback, and a dogfood handoff so the user tests the new iteration on a real part. Run after substantive changes when the user wants to try the new build.
---

# /deploy — put a verified build in the user's hands

A desktop app has no server: "deployed" means artifacts built from a known
commit, smoke-verified by machine against the *packaged* bytes, and handed to
the user with a dogfood script — so their first real use is confident, not
exploratory. This skill is the one place that overwrites `dist-live/`.

**Preconditions (refuse to proceed if unmet):**
1. Working tree clean, or the user explicitly okayed deploying dirty state.
   Either way, record the exact sha (and dirty files) in the report.
2. Ship bar: `npx vitest run` green **twice** and `npm run typecheck` clean
   (run them; don't trust memory — this is `/shipshape`'s tests gate).

## 1. Build the artifacts — one build, two packages

```sh
npm run build                                 # electron-vite: main + preload + renderer
npx electron-builder --win zip --linux dir    # → release/: *-win.zip + linux-unpacked/
```

Both packages come from the same `npm run build` output — the smoke test must
exercise the same bytes being shipped. `linux-unpacked/` exists to be
smoke-tested under WSLg; the Windows **zip** is the artifact the user runs.

**Why zip and not `Setup.exe` (ADR-0010):** NSIS builds its uninstaller by
*executing* the installer, so the `nsis` target needs wine on Linux and fails
with `spawn wine ENOENT`. wine was rejected — it fixes one step today and does
nothing for the native modules arriving with ADR-0007, which cannot cross-compile
from Linux at all. **The `Setup.exe` is CI's job**, built natively on a
`windows-latest` runner. Until that lands, `/deploy` ships the zip and says so;
afterwards this step becomes "fetch the CI artifact for this sha".

## 2. Smoke the packaged build (Playwright)

```sh
npm run e2e:packaged      # PACKAGED_APP=release/linux-unpacked/... playwright test
```

Runs every spec in `e2e/` against the packaged binary via `_electron.launch()`:
`smoke.spec.ts` loads golden parts from `samples/` through the picker path and
asserts the hand-computed count / verdict / binding constraint from
`samples/goldens.ts`, and `packing-ui.spec.ts` covers auto-run, truncated
layouts, the unit picker, and the view toggle. Failure screenshots and traces
land in `test-results/`.

**Dev-mode green does not count** (ADR-0005) — packaged builds fail in
packaged-only ways: `file://` asset paths, the 7.6 MB WASM load, module workers.
A smoke failure here is a deploy stopper: read the failure and its trace before
touching anything.

Needs a display and software GL: WSLg supplies the display locally, the
SwiftShader flags live in `e2e/harness.ts`, and CI will additionally need
`xvfb`.

## 3. Stage with rollback

```sh
rm -rf dist-live.prev
[ -d dist-live ] && mv dist-live dist-live.prev      # keep exactly one previous build
mkdir dist-live && cp release/*-win.zip dist-live/
git rev-parse --short HEAD > dist-live/BUILD_SHA
```

Then print the Windows-reachable path so the user can open it:
`\\wsl.localhost\<distro>\home\oof\packaging-estimator\dist-live\<file>`
(get `<distro>` from `$WSL_DISTRO_NAME`). Copy the zip out of WSL before
unzipping — running from the `\\wsl.localhost` share works but is slow.

The Windows unzip/launch itself is the user's step — WSL cannot verify it; say
so rather than implying it. Two things to state plainly rather than bury:
- the app is **unsigned**, so SmartScreen will warn on first run (More info →
  Run anyway);
- a zip has **no Start-menu entry and no uninstaller** — delete the folder to
  remove it. Both go away when CI produces the signed-or-not NSIS installer.

## 4. Dogfood handoff

The machine check proved the build on golden inputs; dogfooding proves it on
real ones. Tell the user concretely what to exercise on a **real part from
their current work** — the surfaces this iteration touched, plus the standing
trio: does the count survive a sanity check, does the packed view match the
numbers, is the binding constraint (geometry vs weight) attributed right?
Any surprise gets written down immediately as a carry-in on the relevant
`doc/roadmap.md` item — dogfood findings evaporate if they only live in chat.

## 5. Report

```
DEPLOYED — packaging-estimator @ <sha> → dist-live/
  ship bar     vitest <n>/<n> ×2 · typecheck clean
  artifacts    <zip name, MB> (ship) + linux-unpacked (smoke target) — same build
  smoke        <n>/<n> e2e green vs PACKAGED build · traces in test-results/
  run          \\wsl.localhost\<distro>\...\dist-live\<file>  (user unzips on Windows)
  caveats      unsigned (SmartScreen) · no installer/uninstaller until CI (ADR-0010)
  rollback     dist-live.prev/ holds the previous build (BUILD_SHA <prev sha>)
  dogfood      <the 2-3 things to try on a real part this iteration>
```

Rollback is one swap: the previous build sits whole in `dist-live.prev/`,
stamped with its sha.
