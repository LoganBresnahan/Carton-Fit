# Changelog

Notable changes to Carton Fit, written for someone *using* the app rather than
building it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and what it means for you. The reasoning behind each
change lives in its decision record under [`doc/adr/`](doc/adr/), linked inline;
build order lives in [`doc/roadmap.md`](doc/roadmap.md).

## [1.1.0] — 2026-07-27

### Added

- **A "doesn't fit" now tells you what room was left.** Under the list of parts
  that did not fit, the estimate says how big the largest usable gap in the
  carton was and what the smallest leftover part needs — for example *"Largest
  free space: 3 × 3 × 2.2 in — smallest orientation of “rod” needs 7.9 × 0.4 ×
  0.4 in."* Both figures already account for the clearances you asked for, and
  both are sorted largest-first so they compare at a glance, which is usually
  enough to tell whether the next carton up would do it. The line is left off
  when it would say nothing useful — notably when the weight limit, not the
  space, is what stopped the packing. It explains where this attempt stopped; it
  is still not a proof that nothing would fit.
  ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md))

- **Max quantity shows how many could possibly fit, beside how many it placed.**
  The count now reads *"27,000 fit (upper bound 27,000)"*. Unlike the count, the
  bound is not a best effort — nothing can beat it, whatever the arrangement — so
  the gap between the two numbers tells you how much a cleverer packing could
  still recover, and two identical numbers mean the answer is the most that
  physically fits. Both the free-space line and the bound travel with the copied
  summary and the CSV.
  ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md))

### Changed

- **Fit check finds arrangements it used to miss.** The app now tries two ways of
  packing the carton and keeps whichever fits more — the original layer-by-layer
  method, plus a new one that can drop a part into the space above a shorter
  neighbour instead of leaving that air unused. On assemblies of mixed shapes and
  heights it is the difference between "couldn't find a fit" and a packed carton:
  across a 240-case test sweep it improved the answer on a third of them and made
  none worse. The verdict is still a best effort rather than a proof — "doesn't
  fit" means this app could not find an arrangement, not that none exists — and
  nothing about the screen changes.
  ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md))

- **Max quantity can now mix orientations, so the count goes up.** The instant
  grid answer still appears first and is never made worse, but the app then
  tries rearranging copies in different orientations to use the space a
  one-orientation grid leaves over — standing the last row of parts on end, for
  example. Where the shapes allow it the improvement is real: 1×1×2 blocks in a
  3×3×3 box go from 9 to 13, which is the most that can physically fit. The
  extra search stays within the same responsiveness budget as fit check (about
  two seconds at worst, usually far less), and the result states, as always,
  whether space or the weight limit was the cap.
  ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md))

## [1.0.0] — 2026-07-27

The first release meant to be installed and used. Everything below landed after
the unpublished 0.1.0 tag; the app is also renamed, so read *Upgrading* before
installing over an older build.

### Added

- **The app tells you when a newer version is out.** On start-up it asks GitHub
  whether a newer release has been published and, if so, shows a one-line
  message in the header with a Download link that opens the release page in your
  browser. It never downloads or installs anything by itself, and it never
  interrupts what you are doing. If you are offline — or anything else goes
  wrong — it says nothing at all.
  ([ADR-0021](doc/adr/0021-update-check-and-the-header-status-area.md))
- **Per-kind weight overrides.** In a mixed assembly, set the weight of any
  *kind* of part individually — one entry covers all six instances of a bolt.
  The computed weight shows as a dimmed placeholder, so the default is visible
  without looking entered, and clearing the field gives it back. Hidden below
  two kinds, where the file-wide weight already says everything.
  ([ADR-0018](doc/adr/0018-per-kind-weight-overrides.md))
- **Export.** Copy the estimate as text for a quote or an email, save the
  per-part measurements as a CSV, or save the packed view as a PNG. Warnings
  travel with every export: an answer that is qualified on screen stays
  qualified once it leaves the app.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))
- **Saved estimates.** Estimates you *choose* to keep are saved to a local
  database and browsable as one-line summaries. Restoring one loads its inputs
  and recomputes, so the answer on screen is never a replay of a stored number.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))
- **Undo/redo over the inputs** (Ctrl+Z / Ctrl+Shift+Z). Typing a dimension is
  one step, not one per keystroke; changing length and then width is two.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))

### Changed

- **The app is now Carton Fit**, renamed from Packaging Estimator. In
  manufacturing an *estimator* is the person who prices a job, so the old name
  promised cost-per-unit figures this app does not produce.
  ([ADR-0019](doc/adr/0019-renamed-to-carton-fit.md))
- Estimates are recorded when you **save them**, not automatically on every
  keystroke — the earlier behaviour filled the history with noise nobody chose.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))
- Presets and saved estimates are stacked sections in the inputs column rather
  than columns of their own, and the vocabulary is now explicit: **presets** are
  reusable carton setups with no part attached; **saved estimates** are answers.
- **The app takes about 46 MB less disk once installed**, and the installer is
  roughly 8 MB smaller to download. Nothing was removed that the app uses — it
  was compiler output and duplicate copies of libraries already built into the
  app.
- **Storage problems are now reported in the header** rather than above the
  inputs, and can be dismissed. The message reappears if it happens again, so
  dismissing one report never hides the next. Moving it also gives the drop zone
  back the space the message used to take.
  ([ADR-0021](doc/adr/0021-update-check-and-the-header-status-area.md))
- New app icon.

### Fixed

- Exports no longer warn that a weight is unreliable when you typed that weight
  in by hand. The panel had this right and the export did not, so a document
  that outlives the window could contradict the app it came from.
- Ctrl+Z did nothing after clicking a number field's spinner arrows. The step
  was recorded, but the app deferred undo inside input fields to the browser,
  whose undo buffer holds only *text* edits.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md) §2)
- The presets and saved-estimates lists overhung the inputs column by ~24 px and
  put a horizontal scrollbar on it.
- The measurements CSV wrote its part count with locale grouping
  (`"27,000"`) — the one figure in that file someone computes with, and it
  arrived unusable by every spreadsheet.

### Upgrading from a pre-rename build

- **Your presets, saved estimates and window position are not carried over.**
  The rename changes both the settings directory and the database filename, and
  no migration was written — see
  [ADR-0019](doc/adr/0019-renamed-to-carton-fit.md) for why. Inputs return to
  defaults once.
- The old **Packaging Estimator** remains a separate entry in Programs and
  Features. Uninstall it; nothing is shared between the two.

## [0.1.0] — 2026-07-25

First tagged build: the complete estimate path, end to end.

Tagged and built, but **never published** — its GitHub release is still a draft,
and the work above landed before anyone was handed the artifact.

### Added

- **STEP and STL import**, including multi-part assemblies, parsed off the UI
  thread by OpenCascade compiled to WebAssembly.
  ([ADR-0002](doc/adr/0002-step-import-occt-wasm.md))
- **Two modes** — *fit check* (does everything in this file fit?) and *max
  quantity* (how many fit?) — across **two quality tiers**: *Fast*, from
  axis-aligned bounding boxes over six orientations, and *Thorough*, which
  computes a minimal oriented bounding box and searches rotations. True shape
  nesting is designed for but not implemented.
  ([ADR-0003](doc/adr/0003-packing-modes-and-tiers.md))
- **3D viewport** showing either the imported model or the packed carton with
  every part in its computed position.
  ([ADR-0008](doc/adr/0008-imperative-three-viewport.md))
- **Estimates follow your inputs live** — no compute button.
  ([ADR-0009](doc/adr/0009-auto-run-estimates.md))
- **Weight as a hard constraint.** Max package weight (default 35 lb), part
  weight entered directly or derived from density × mesh volume, with every
  result stating which constraint — space or weight — was binding.
  ([ADR-0004](doc/adr/0004-units-and-weight.md))
- **Clearances** for dunnage and foam, part-to-part and part-to-wall; inner
  carton dimensions directly, or outer dimensions with wall thickness.
- **mm ⇄ inch** display toggle; everything stored in millimeters and grams
  internally. ([ADR-0004](doc/adr/0004-units-and-weight.md))
- **Presets** — carton setups saved under a name, in a local SQLite database.
  ([ADR-0007](doc/adr/0007-storage-better-sqlite3.md))
- **Window size and position survive a restart**, validated against the
  displays attached right now, so a window never opens off-screen.
  ([ADR-0014](doc/adr/0014-window-state-in-a-json-file.md))
- **An open (non-watertight) mesh is flagged rather than silently priced.** A
  density weight resting on one is wrong, and a wrong weight becomes a
  confidently wrong part count.
  ([ADR-0015](doc/adr/0015-flag-unmeasurable-inputs-rather-than-refuse.md))
- **Installers built on their native platform** — a Windows NSIS installer and a
  Linux AppImage, each verified by the full test suite against the *packaged*
  bytes before release.
  ([ADR-0010](doc/adr/0010-release-artifacts-from-ci.md),
  [ADR-0012](doc/adr/0012-ci-shape.md))

### Known limitations

- **The Windows build is unsigned**, so SmartScreen warns on first run
  (More info → Run anyway). No certificate exists yet.
- **No macOS build.** The configuration exists, but a dmg nobody can test is an
  untested artifact wearing a ship label; it waits for a Mac to verify it on.
- **No auto-update.**

[Unreleased]: https://github.com/LoganBresnahan/Carton-Fit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v1.0.0
[0.1.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v0.1.0
