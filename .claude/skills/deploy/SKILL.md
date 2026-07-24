---
name: deploy
description: Build the current packaging-estimator iteration into installable artifacts and put a verified build in the user's hands. Ship bar first (vitest green twice + typecheck), then electron-builder outputs (Windows NSIS Setup.exe as the ship artifact, linux-unpacked from the same build as the smoke target), Playwright smoke against the PACKAGED build using the golden samples, artifacts staged with the previous build kept for rollback, and a dogfood handoff so the user tests the new iteration on a real part. Run after substantive changes when the user wants to try the new build.
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
npm run build                                  # electron-vite: main + preload + renderer
npx electron-builder --win nsis --linux dir    # → release/: Setup.exe + linux-unpacked/
```

Both packages come from the same `npm run build` output — the smoke test must
exercise the same bytes being shipped. `Setup.exe` is the ship artifact
(cross-built from WSL); `linux-unpacked/` exists to be smoke-tested under WSLg.

## 2. Smoke the packaged build (Playwright)

```sh
PACKAGED_APP=release/linux-unpacked/packaging-estimator npx playwright test e2e/smoke.spec.ts
```

The smoke spec launches the packaged binary via `_electron.launch()`, loads a
golden part from `samples/` through the picker path, enters the golden box
spec, and asserts the known-correct count, orientation, and binding constraint
(see ADR-0005); screenshots land in `test-results/`. **Dev-mode green does not
count** — packaged builds fail in packaged-only ways (asset paths, WASM
loading, workers). A smoke failure here is a deploy stopper: read the spec's
failure and screenshot before touching anything.

## 3. Stage with rollback

```sh
rm -rf dist-live.prev
[ -d dist-live ] && mv dist-live dist-live.prev      # keep exactly one previous build
mkdir dist-live && cp release/*Setup*.exe dist-live/
git rev-parse --short HEAD > dist-live/BUILD_SHA
```

Then print the Windows-reachable path so the user can double-click it:
`\\wsl.localhost\<distro>\home\oof\packaging-estimator\dist-live\<file>`
(get `<distro>` from `$WSL_DISTRO_NAME`). The Windows install/launch itself is
the user's step — WSL cannot verify it; say so rather than implying it.

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
  artifacts    <Setup.exe name, MB> (ship) + linux-unpacked (smoke target) — same build
  smoke        e2e/smoke.spec green vs packaged build · screenshots in test-results/
  install      \\wsl.localhost\<distro>\...\dist-live\<file>  (user installs on Windows)
  rollback     dist-live.prev/ holds the previous installer (BUILD_SHA <prev sha>)
  dogfood      <the 2-3 things to try on a real part this iteration>
```

Rollback is one swap: the previous installer sits whole in `dist-live.prev/`,
stamped with its sha.
