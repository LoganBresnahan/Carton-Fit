# ADR-0011: MIT for our code; LGPL honoured by a replaceable WASM, not a disclaimer

Date: 2026-07-25
Status: Accepted
Relates to: ADR-0002 (occt-import-js), ADR-0010 (release artifacts from CI)

## Context

Roadmap item 10 publishes releases on GitHub, which means the repository goes
public and the installer goes to people who are not the author. Both need a
licence answer, and the maintainer chose **MIT**.

An audit of every direct dependency found them all MIT or Apache-2.0 with one
exception: **`occt-import-js` 0.0.23 is LGPL-2.1**. The bundled licence text is
plain LGPL-2.1 — checked, and it carries **no Open CASCADE Exception**, so the
weaker permissions some OCCT distributions grant cannot be relied on.

MIT source depending on an LGPL library is unremarkable and creates no
obligation on our own code. The obligation attaches to the **distributed
binary**, and it is not satisfied by listing the licence: LGPL-2.1 §6 exists so
a recipient can swap in their own build of the library. A notices file that
merely names the licence would be a disclaimer, not compliance.

Two facts made the honest option cheap. The `.wasm` is already loaded at runtime
via Emscripten's `locateFile` rather than base64-inlined into a bundle, so it is
a discrete artifact. And Electron already establishes where licence texts belong
— it ships `LICENSE.electron.txt` and `LICENSES.chromium.html` at the app root.

## Decision

- **Our code is MIT** (`LICENSE`, `package.json`). `"private": true` stays — it
  blocks accidental `npm publish` and is unrelated to repository visibility.
- **`THIRD-PARTY-NOTICES.md` is a shipped artifact, not documentation.** It
  lists every component in the distributed binary with version, licence, source,
  and whether we modified it. `extraFiles` places it at the application root
  beside Electron's own licence files, along with our `LICENSE`.
- **The LGPL relink right is implemented, not asserted.** The occt `.wasm` is
  excluded from `app.asar` via `asarUnpack`, so substituting a self-compiled
  build is a single file copy at a documented path — no repack, no rebuild, no
  tooling.
- **The substitution is verified by test, not by reading the config.** Replacing
  the file with an invalid one must make the packaged app fail to import STEP;
  if it still succeeds, the app is reading an embedded copy and the claim is
  false.
- **ASAR integrity enforcement stays off** while this is how compliance is met.
- Build-time-only tooling is not listed: it is not in the distributed binary.

## Consequences

- The repository can go public, and releases can be published, without an open
  licensing question hanging over the installer.
- Adding a runtime dependency now has a third obligation beyond an ADR and the
  dependency list in CLAUDE.md: a line in `THIRD-PARTY-NOTICES.md`. A shipped
  dependency missing from that file makes the release non-compliant, so
  `/shipshape`'s docs gate checks it.
- `asarUnpack` is load-bearing for compliance rather than for performance. That
  is a non-obvious reason for a build setting to exist, so it is commented as
  such at the config site — the failure mode is someone "tidying" it away and
  silently breaking the guarantee, with every test still green.
- Verified on Linux only. Windows is the ship target (VISION), so the
  substitution check has to be repeated against the CI-built installer — folded
  into item 10 rather than left implicit.
- Enabling ASAR integrity later would break the guarantee at load time without
  failing any existing test. Recorded as a revisit trigger rather than trusted
  to memory.
- We take on no obligation for Chromium's own LGPL components: FFmpeg already
  ships as a replaceable shared library, and `LICENSES.chromium.html` remains
  authoritative for that layer. We point at it instead of duplicating it.

## Alternatives considered

- **A licence list with no relink seam** — the common practice, and the smallest
  change. Rejected: for a statically-bundled LGPL component it is precisely the
  obligation LGPL-2.1 §6 adds on top of attribution. Getting this wrong is
  cheap to avoid now and expensive to discover after publishing.
- **Drop occt-import-js for a permissive STEP parser** — removes the question
  entirely. Rejected: ADR-0002 chose it because there is no comparable
  permissively-licensed STEP kernel; the product's core input format depends on
  it, and LGPL compliance here costs one build setting.
- **Rely on an Open CASCADE Exception** — would relax §6 substantially. Rejected
  on inspection: the text bundled with 0.0.23 does not include it. Assuming
  otherwise would have been the easy, wrong answer.
- **Ship the library's full source in the installer** — also satisfies §6, and
  is unambiguous. Rejected as disproportionate: it inflates every download to
  carry a source tree, when a stable upstream URL plus genuine replaceability
  achieves the same end.
- **Generate the notices file from `node_modules` at build time** — scales, and
  removes the chance of it going stale. Rejected for now: with six runtime
  dependencies, generated output would be longer and less useful than the
  hand-written explanation the LGPL entry actually needs. Revisit when the
  dependency list stops fitting on one screen.

## Revisit triggers

- A new runtime dependency that is not MIT/BSD/Apache-2.0 → re-read this ADR
  before adding it; copyleft in the shipped binary is the case to think hard
  about.
- ASAR integrity enforcement, code signing, or anything else that makes the
  packaged app tamper-evident → the relink guarantee and this decision collide;
  resolve deliberately.
- occt-import-js ships a version carrying the Open CASCADE Exception → the
  `asarUnpack` seam may become optional (keep it anyway unless it costs
  something).
- The dependency list outgrows a hand-maintained file → generate it.
- Anyone asks to relicense, or a contributor arrives → MIT inbound=outbound is
  assumed here; revisit if that stops being true.
