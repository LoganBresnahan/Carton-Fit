---
name: deploy
description: Put a verified Carton-Fit build in the user's hands. Ship bar first (vitest green twice + typecheck), then obtain artifacts — preferring the CI-built Windows installer for the current sha (ADR-0012), falling back to a local wine-free build — verify against the PACKAGED bytes using the golden samples, stage to dist-live/ with the previous build kept for rollback, and hand off a dogfood script so the user tests the new iteration on a real part. Run after substantive changes when the user wants to try the new build.
---

# /deploy — put a verified build in the user's hands

A desktop app has no server: "deployed" means artifacts built from a known
commit, verified by machine against the *packaged* bytes, and handed to the user
with a dogfood script — so their first real use is confident, not exploratory.
This skill is the one place that overwrites `dist-live/`.

**Preconditions (refuse to proceed if unmet):**
1. Working tree clean, or the user explicitly okayed deploying dirty state.
   Either way, record the exact sha (and dirty files) in the report.
2. Ship bar: `npm test` green **twice** and `npm run typecheck` clean
   (run them; don't trust memory — this is `/shipshape`'s tests gate).
   Use `npm test`, not `npx vitest run`: the `pretest` hook restores
   better-sqlite3's Node-ABI build, and packaging leaves it compiled for
   Electron (ADR-0013). This matters here more than anywhere, because `/deploy`
   packages and tests in the same session.

## 1. Obtain the artifacts — CI first, local build as fallback

Two paths. **Prefer path A**: it produces the real Windows installer, built and
verified on Windows, which a WSL build cannot do at all (ADR-0010).

### Path A — fetch the CI build for this exact sha (preferred)

```sh
SHA=$(git rev-parse HEAD)
RUN=$(gh run list --workflow=release.yml --commit "$SHA" --status success \
        --limit 1 --json databaseId --jq '.[0].databaseId')
```

If `$RUN` is non-empty, that run built **and verified** these bytes:
`--status success` means its Windows leg passed the full packaged e2e suite, the
ASAR-integrity fuse check, and the LGPL substitution check (ADR-0011) — on
Windows, against the artifact you are about to hand over.

```sh
gh run download "$RUN" --name windows-installer --dir /tmp/deploy-artifacts
```

No release.yml run for this sha? Trigger one and wait, rather than silently
falling back — the installer is worth the four minutes:

```sh
gh workflow run release.yml && gh run watch <new-run-id> --exit-status
```

(`workflow_dispatch` builds and verifies but never publishes; only a `v*` tag
creates the draft release.) Artifacts expire after 14 days — an old sha may need
a fresh run.

### Path B — local build (no CI run available, or offline)

```sh
npm run build                                 # electron-vite: main + preload + renderer
npx electron-builder --win zip --linux dir    # → release/: *-win.zip + linux-unpacked/
```

**This path cannot produce `Setup.exe`** (ADR-0010): NSIS builds its uninstaller
by *executing* the installer, so the `nsis` target needs wine on Linux and dies
with `spawn wine ENOENT`. wine was rejected — it fixes one step today and does
nothing for the native modules arriving with ADR-0007. So path B ships the zip
and **must say so**: no Start-menu entry, no uninstaller.

Both packages come from the same `npm run build`, so the smoke test in step 2
exercises the same bytes being shipped.

## 2. Verify the packaged bytes

**Path A — already verified, and by the better machine.** Do not re-run the
Linux suite to feel thorough: it would test a *different* artifact (the AppImage
or a local build) than the installer being handed over. Record what CI actually
ran, with the run id, and move on. If you want the provenance in the report,
`gh run view "$RUN"` lists the steps.

**Path B — smoke locally, against the packaged binary:**

```sh
npm run e2e:packaged      # PACKAGED_APP=release/linux-unpacked/... playwright test
```

Runs every spec in `e2e/` via `_electron.launch()`: `smoke.spec.ts` loads golden
parts from `samples/` through the picker path and asserts the hand-computed
count / verdict / binding constraint from `samples/goldens.ts`;
`packing-ui.spec.ts` covers auto-run, truncated layouts, the unit picker, and the
view toggle. Traces land in `test-results/`.

**Dev-mode green does not count** (ADR-0005) — packaged builds fail in
packaged-only ways: `file://` asset paths, the 7.6 MB WASM load, module workers.
A smoke failure is a deploy stopper: read the failure and its trace before
touching anything. Needs a display and software GL; WSLg supplies the display
locally and the SwiftShader flags live in `e2e/harness.ts`.

Note what path B cannot tell you: it verifies a *Linux* build. The Windows bytes
are only ever machine-verified by CI.

## 3. Stage with rollback

```sh
rm -rf dist-live.prev
[ -d dist-live ] && mv dist-live dist-live.prev      # keep exactly one previous build
mkdir dist-live
cp /tmp/deploy-artifacts/*Setup*.exe dist-live/      # path A: the installer
# cp release/*-win.zip dist-live/                    # path B: the zip
git rev-parse --short HEAD > dist-live/BUILD_SHA
```

Stage **one** runnable artifact, not everything available — `dist-live/` is what
the user runs, not an archive. Then print the Windows-reachable path:
`\\wsl.localhost\<distro>\home\oof\Carton-Fit\dist-live\<file>`
(get `<distro>` from `$WSL_DISTRO_NAME`). Copy it out of WSL before running —
launching from the `\\wsl.localhost` share works but is slow.

The Windows install/launch is the user's step — WSL cannot verify it; say so
rather than implying it. State plainly rather than bury:

- the app is **unsigned**, so SmartScreen warns on first run (More info → Run
  anyway). True on both paths; code signing isn't set up (ADR-0010).
- **path B only:** a zip has no Start-menu entry and no uninstaller — delete the
  folder to remove it. Path A's installer has both.

## 4. Dogfood handoff

The machine check proved the build on golden inputs; dogfooding proves it on real
ones. Tell the user concretely what to exercise on a **real part from their
current work** — the surfaces this iteration touched, plus the standing trio:
does the count survive a sanity check, does the packed view match the numbers, is
the binding constraint (geometry vs weight) attributed right? Any surprise gets
written down immediately as a carry-in on the relevant `doc/roadmap.md` item —
dogfood findings evaporate if they only live in chat.

## 5. Report

```
DEPLOYED — Carton-Fit @ <sha> → dist-live/
  ship bar     vitest <n>/<n> ×2 · typecheck clean
  artifacts    <file, MB> — <CI run <id>, windows-latest | local build, wine-free>
  verified     <n>/<n> e2e + ASAR fuse + LGPL substitution on Windows (CI run <id>)
               | <n>/<n> e2e vs the packaged LINUX build (local)
  run          \\wsl.localhost\<distro>\...\dist-live\<file>
  caveats      unsigned (SmartScreen) <· zip: no Start-menu entry or uninstaller>
  rollback     dist-live.prev/ holds the previous build (BUILD_SHA <prev sha>)
  dogfood      <the 2-3 things to try on a real part this iteration>
```

Rollback is one swap: the previous build sits whole in `dist-live.prev/`, stamped
with its sha.

**A draft release is not a deploy.** A `v*` tag makes CI attach artifacts to a
*draft* GitHub release; publishing it is a separate, human act after dogfooding
(ADR-0012). `/deploy` stages to `dist-live/` and never publishes — if the user
wants the release public, that is `gh release edit <tag> --draft=false`, asked
for explicitly.
