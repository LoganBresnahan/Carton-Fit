# ADR-0013: better-sqlite3 is compiled from source; prebuilds are a convenience, not a dependency

Date: 2026-07-25
Status: Accepted
Supersedes: ADR-0007's "electron-builder fetches the platform prebuilt … no MSVC
toolchain in WSL" decision bullet, and its 2026-07-25 amendment
Corrects: ADR-0010's measurement of better-sqlite3 prebuild availability

## Context

ADR-0007 planned to rely on published prebuilt binaries so no compiler would be
needed. ADR-0010 amended that to "pin a version that ships prebuilds (v12.x
today)". Implementing roadmap item 7 tested both claims for the first time, and
the pin they name **does not exist on npm**:

| measured 2026-07-25 | result |
| --- | --- |
| Electron 43's ABI (asked the binary: `process.versions.modules`) | **148** |
| better-sqlite3 **12.12.0** — the version both ADRs name | **not published to npm** (`E404`); GitHub release only |
| highest 12.x actually on npm | **12.11.1** — 138 prebuilds, tops out at **ABI 146** |
| 12.12.0's assets (GitHub) | 145 prebuilds, and they *do* include `electron-v148` |
| 13.0.1 (latest) | **0 prebuilds** |

So the earlier measurement read GitHub releases and assumed npm parity. It does
not hold: **there is no npm-installable better-sqlite3 with a prebuild for our
Electron ABI.** The strategy of "pin to a version whose prebuilds cover us" has
no version to point at.

Measured alternatives, on this machine (WSL2, gcc/g++/make/python3 present):

- `npm install better-sqlite3@12.11.1` → **0.9 s**, fetches the *Node*-ABI
  prebuild (ABI 141 locally).
- `electron-builder install-app-deps` → **61 s**, compiles from source against
  Electron 43, and the result loads and runs under ABI 148.
- `npm rebuild better-sqlite3` → **0.5 s**, restores the Node-ABI prebuild.

## Decision

**Compile better-sqlite3 from source for Electron; do not depend on prebuilds
existing for our ABI.**

- `npmRebuild: true` in `electron-builder.yml` (it was `false`, correct only
  while there were no native modules). electron-builder invokes
  `@electron/rebuild` at package time and builds against the Electron ABI.
- **Pin `better-sqlite3` to exactly `12.11.1`.** Not for Electron prebuilds —
  those do not exist for ABI 148 at any npm version — but because its *Node*-ABI
  prebuilds make `npm ci` ~1 s instead of a source build, on three CI jobs and
  every local install. The pin is exact so the ABI story never moves silently.
- Windows compiles on the `windows-latest` CI runner with MSVC. This is exactly
  the fallback ADR-0010 named, now the primary path rather than the backstop.
- Local WSL builds keep working because a Linux toolchain is already present;
  `node-gyp` needs `gcc`/`g++`/`make`/`python3`, which is now a documented
  development prerequisite rather than an accident.

## Consequences

- **The prebuild lottery is over.** No future Electron upgrade can be blocked by
  a missing prebuild — it just compiles. ADR-0007's revisit trigger ("an Electron
  upgrade whose ABI has no better-sqlite3 prebuilds → wait or pin") is retired;
  the guard becomes "does it still *compile*", which CI answers on every push.
- **Node ABI and Electron ABI are mutually exclusive in one working tree.** One
  `.node` file, one ABI: after `npm run package`, vitest cannot load the module
  (ABI 148 vs Node's 141) until `npm rebuild better-sqlite3` restores it, and
  vice versa. That is inherent to a V8-ABI (non-N-API) module — verified:
  `nm -D` shows 49 undefined `v8::` symbols and `node_module_register`, and zero
  `napi_` symbols.
  - CI is already ordered safely: `ci.yml` runs vitest *before* `npm run
    package`, and the e2e step drives the packaged app, which carries its own
    copy.
  - Locally the trap is real. `npm test` after `npm run package` fails
    confusingly, and the 0.5 s fix is `npm rebuild better-sqlite3`. Wiring that
    into a `pretest` hook is the obvious mitigation and belongs with the
    packaging slice, once something actually loads the module.
- CI gains ~1 min per packaging step on each platform for the compile. Acceptable
  against a per-push budget already dominated by packaging and e2e.
- A build toolchain is now required to develop this app on Linux. It was already
  present here, but it is no longer optional and must be documented.
- `better-sqlite3` is MIT, so `THIRD-PARTY-NOTICES.md` gains a row and nothing
  about ADR-0011's licensing posture changes.

## Alternatives considered

- **Downgrade Electron to an ABI ≤ 146** so 12.11.1's prebuilds apply. Cheapest
  install, and rejected on principle: it pins the application's runtime to a
  dependency's release cadence. ADR-0007's own trigger contemplates *waiting* on
  an upgrade, never walking one back.
- **Install 12.12.0 from its GitHub tarball URL.** Gets a real ABI-148 prebuild
  today. Rejected: a non-registry dependency source is a supply-chain and
  reproducibility cost this repo has taken nowhere else, to avoid a 60 s compile.
- **Wait for 12.12.0 (or later) to reach npm.** Unknown timing, and item 7 stalls
  behind someone else's publish button.
- **Adopt an N-API SQLite binding instead** (e.g. `node-sqlite3-wasm`, or the
  `@signalapp/sqlcipher` route ADR-0007 already rejected). N-API would end the
  dual-ABI split outright. Rejected for now because it reopens ADR-0007's
  library choice, which was made on a documented reference-app post-mortem — but
  this is the alternative to revisit if the ABI split becomes a daily nuisance.

## Revisit triggers

- The dual-ABI dance starts costing real time (developers hitting it weekly) →
  either wire the `pretest` rebuild or reopen the N-API alternative above.
- better-sqlite3 ships an N-API build → the split disappears; re-evaluate the pin.
- A better-sqlite3 release lands on npm with prebuilds covering our Electron ABI
  → prebuilds become a speed win again, but **do not** make them a dependency;
  this decision is that we must always be able to compile.
- The compile fails on a CI runner (missing toolchain after an image change) →
  that is a CI prerequisite to pin explicitly, like `xvfb` was.
- `node:sqlite` stabilizes in Electron's Node (ADR-0007's standing trigger) →
  the native dependency, and this ADR with it, may go away entirely.
