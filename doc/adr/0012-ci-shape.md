# ADR-0012: CI shape — verify on push, build on tag, draft releases, Windows self-verifies

Date: 2026-07-25
Status: Accepted
Implements: ADR-0010 (release artifacts from per-platform CI)
Relates to: ADR-0005 (test layers), ADR-0011 (LGPL re-verification on Windows)

## Context

ADR-0010 decided *that* release artifacts come from a per-platform GitHub
Actions matrix. It left the workflow's shape open: what triggers what, which
runners run which checks, how releases are published, and how `/deploy`
consumes CI output instead of building locally. The repo is now public
(github.com/LoganBresnahan/Carton-Fit), so Actions minutes are free
and macOS/Windows runners are available.

Constraints already established elsewhere, restated so this ADR reads alone:

- The ship artifact is the Windows NSIS `Setup.exe`; Windows is the product
  target and Linux/WSL a development convenience (VISION).
- E2E needs a display: `xvfb` on Linux runners (WSLg does not exist there);
  Windows runners have a desktop session natively. SwiftShader flags are
  already harness-only in `e2e/harness.ts` (ADR-0005).
- Two Linux-only verifications must be repeated against the Windows build:
  the LGPL wasm-substitution test and the ASAR-integrity-off check (ADR-0011).
- Native modules (better-sqlite3, item 7) compile with MSVC on `windows-latest`
  when no prebuild matches (ADR-0010) — CI must not assume prebuilds.

## Decision

**Two workflows, split by cadence:**

1. **`ci.yml` — verify, every push to main and every PR.** One
   `ubuntu-latest` job: `npm ci`, typecheck, vitest, `npm run package`, then
   `xvfb-run npm run e2e:packaged`. This is `/shipshape`'s machine half plus
   the packaged smoke — the same gates, so green here means what green means
   locally. No artifacts kept beyond Playwright traces on failure.

2. **`release.yml` — build, on tag `v*` only.** A two-leg matrix:
   - `windows-latest`: `electron-builder --win nsis zip` → `Setup.exe` (ship)
     + zip. The Windows leg **re-runs `e2e:packaged` against `win-unpacked`**
     — the display exists, Playwright-Electron works there, and this is the
     only machine that can discharge ADR-0011's carry-in: the run includes
     the wasm-substitution check (junk wasm → STEP import must fail) and
     asserts ASAR integrity is not enforced.
   - `ubuntu-latest`: `electron-builder --linux AppImage` — near-free since
     the config exists, and it gives Linux users something runnable.
   - **No macOS leg yet.** A dmg nobody can dogfood is an untested artifact
     with a ship label; deferred until a Mac exists to verify it (this is
     the standing ADR-0005 principle, not thrift).

**Releases are drafts.** `release.yml` uploads artifacts to a **draft** GitHub
release for the tag. Publishing is a human act, after dogfooding the built
installer — the same judgment `/deploy` step 4 already encodes. Nothing ships
because a tag was pushed by mistake.

**Versioning:** tag `vX.Y.Z` must equal `package.json` version; the workflow
fails the build on mismatch rather than shipping a mislabeled installer.

**`/deploy` grows the fetch path (ADR-0010's promised amendment):** when the
current sha has a completed release build, `/deploy` downloads the CI artifact
(`gh release download` / `gh run download`) into `dist-live/` instead of
building — same staging, same rollback, same handoff; only the build step is
replaced. Local zip build remains the fallback when CI hasn't run for the sha.

## Consequences

- Every push to main gets the full packaged smoke on a clean machine — the
  first machine-check of this project outside WSL.
- The Windows installer is finally *verified where it ships*: e2e, LGPL
  substitution, and ASAR check all run on `windows-latest`, closing item 10's
  carry-in mechanically instead of by a human checklist.
- Draft releases put a human between "tag pushed" and "public download" —
  dogfooding stays in the loop, matching the existing deploy culture.
- Two workflows to maintain instead of one, but neither does the other's job:
  verify is fast and constant, build is heavy and rare.
- The Windows e2e leg will surface real Windows-only failures (path
  separators, file-dialog behavior). That is the point; expect the first tag
  to need iteration.
- CI runs `npm ci` from a cold cache each time until caching is added — a
  plan-level optimization, not a decision.
- The version-match gate means releasing requires touching `package.json` —
  deliberate friction, one honest version per installer.

## Alternatives considered

- **Build artifacts on every push to main** — maximum availability, but it
  burns the heavy Windows leg constantly to produce installers nobody asked
  for, and it blurs "latest green" with "releasable". Tags are the existing
  human gesture for "this one matters".
- **Auto-publish releases on tag** — standard in many repos. Rejected: it
  deletes the dogfood step from the one path that reaches the public, and this
  project's deploy culture (ADR-0005) is built on a human trying the build.
- **One workflow with conditional steps** — fewer files, but every push would
  evaluate release logic, and the failure surface mixes "your commit broke
  tests" with "the installer didn't build". Cadence split is cleaner.
- **All three platforms from day one** — the mac leg costs little to add but
  produces an artifact nobody can verify. Deferred, not rejected.
- **E2E only on Linux (Windows just packages)** — cheaper, and what most
  Electron projects do. Rejected here because ADR-0011's obligations are
  Windows-specific and cannot be discharged on a Linux runner.

## Revisit triggers

- A Mac becomes available for dogfooding → add the `macos-latest` leg and dmg.
- Item 7 lands better-sqlite3 → confirm the Windows leg compiles it (MSVC)
  and the Linux leg's AppImage carries the right prebuild; `npmRebuild` and
  the `files` list in electron-builder.yml both change.
- Code signing arrives → certificates live in repo secrets on the Windows
  leg; revisit how they're held (ADR-0010 trigger, restated).
- Release cadence outgrows drafts (auto-update via electron-updater, roadmap
  "Later") → publishing semantics change; supersede this section.
- CI minutes stop being free (repo goes private) → re-read ADR-0010's
  fallback (Windows-side local build), not wine.
