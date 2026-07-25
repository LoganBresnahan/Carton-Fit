# ADR-0010: Release artifacts come from per-platform CI; local builds stay wine-free

Date: 2026-07-25
Status: Accepted
Amends: ADR-0001 (one consequence, not the shell decision), ADR-0005 (`/deploy` step 1)

## Context

ADR-0001 chose Electron partly on the claim that **"Windows NSIS installers cross-build
routinely from Linux/WSL"**. Roadmap item 8 tested that claim for the first time, and it
is false as stated:

- Packaging both platforms works natively, and `makensis` has a Linux build that
  electron-builder downloads and runs.
- But **NSIS generates its uninstaller by executing the freshly built installer once** —
  running a Windows `.exe`. On Linux that requires **wine**, and without it the build
  dies with `spawn wine ENOENT`. Neither `signAndEditExecutable: false` nor
  `signExecutable: false` avoids it; those skip a *different*, earlier wine call for exe
  metadata and signing.
- `--win zip` has no uninstaller and therefore cross-builds cleanly, as does `linux dir`.

A second, larger constraint arrives with ADR-0007's storage work. `better-sqlite3` is a
native module, and native modules **cannot be cross-compiled for Windows from Linux at
all** — that needs MSVC, which does not exist there. ADR-0007 planned around this by
relying on published prebuilt binaries ("electron-builder fetches the platform prebuilt
… no MSVC toolchain in WSL"), which works only while prebuilds exist for our Electron
ABI. Measured 2026-07-25: better-sqlite3 **v13.x publishes no prebuilt binaries at all**
(v12.12.0 publishes 145), and prebuild coverage always lags new Electron majors — we are
on Electron 43.

So wine would buy exactly one build step, today, and is powerless against the constraint
most likely to break Linux-only builds next.

## Decision

- **Release artifacts are built per-platform in CI** (GitHub Actions matrix), not
  cross-built. A `windows-latest` runner builds the NSIS `Setup.exe` natively — no wine,
  and native modules compile with MSVC when a prebuild is missing. This is the same
  machine that will later carry code signing.
- **Local WSL builds are limited to wine-free targets:** `linux dir` (the e2e smoke
  target) and `win zip` (a runnable Windows build, unzip-and-go, for dogfooding).
- **wine is explicitly not adopted.**
- `/deploy` stages what the local build can produce and says so plainly; the installer is
  CI's output, and `/deploy` grows a "fetch the CI artifact" path when CI lands.

## Consequences

- ADR-0001's *shell* decision is untouched; only its cross-build consequence is
  corrected. Electron is still right for the reasons given there.
- ADR-0007's "no MSVC toolchain in WSL" holds only while prebuilds exist. CI-native
  compilation becomes the fallback, which removes the prebuild lottery from the critical
  path — but item 7 should still prefer a better-sqlite3 version that ships prebuilds
  (v12.x today) so local development keeps working.
- Dogfooding on Windows uses the zip until CI lands: a real build of the real bytes, but
  no Start-menu entry and no uninstaller. That gap is stated to the user at handoff, not
  hidden.
- Installer-specific behaviour (install path, shortcuts, uninstall, SmartScreen on an
  unsigned exe) is verified against the CI artifact on Windows, by a human — consistent
  with ADR-0005's existing split, which already says WSL machine-verifies app behaviour
  while Windows install UX is human-verified.
- No 1 GB wine dependency in the dev environment, and no second checkout to maintain.
- CI moves from "Later" to a near-term roadmap item, because it now owns the ship
  artifact rather than being a nice-to-have.

## Alternatives considered

- **Install wine in WSL** — the smallest change today, and it would make `/deploy` work
  exactly as ADR-0005 specifies. Rejected: it fixes one step with a known expiry date at
  item 7, adds ~1 GB to the dev environment, and would still leave release artifacts
  being built on a developer laptop rather than a clean machine.
- **A Windows-side checkout, building from PowerShell** — solves both wine and native
  modules, and matches the Windows-native target most directly. Rejected as the *primary*
  path: it splits the toolchain across two OSes, must be repeated by hand every release,
  and WSL could no longer machine-verify the shipped artifact. It remains the fallback if
  CI is unavailable.
- **electron-builder's wine Docker image** (`electronuserland/builder:wine`) — packages
  the wine dependency away, but inherits the same native-module ceiling and adds Docker
  to a WSL dev loop. Rejected for the same expiry reason.

## Revisit triggers

- CI becomes unavailable or unacceptable (air-gapped work, private-repo minutes) → the
  Windows-side build becomes primary, not wine.
- Code signing is adopted → it belongs on the same CI runner; revisit how certificates
  are held before adding it.
- better-sqlite3 resumes publishing prebuilds covering our Electron ABI *and* a local
  Windows installer is genuinely wanted → wine becomes viable again, but only for NSIS.
- Electron's own packaging story changes such that the uninstaller no longer requires
  executing the installer.
