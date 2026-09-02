# Roadmap

Frontier = first unchecked item under **Now**, else first under **Next**.
Check items off as they ship; pin carry-ins (deferred sub-tasks, open questions) to the
item they belong to. Product intent lives in `VISION.md`; decisions in `adr/`.

## Now

- [x] 0. Repo setup — vision doc, ADRs 0001–0004, CLAUDE.md, skills, this roadmap
- [x] 1. Scaffold — electron-vite (React + TS) app boots; drag-drop reads a file and
      shows its name/size; `npm run dev` / `npm test` / typecheck all work
- [x] 2. Import + view — STEP parsing via occt-import-js in a worker; parts listed;
      parts rendered in three.js with orbit controls; STL path too
      (ADR-0002 import pipeline + ADR-0008 imperative-three viewport)
- [x] 3. Inputs panel — box dims (inner, or outer + wall thickness), mm ⇄ in toggle,
      clearances, max weight (default 35 lb), part weight (direct or density × volume),
      mode + quality selectors; values persisted (localStorage)
      (ADR-0003 contract + fast engines + selectors; ADR-0004 input fields)
- [x] 4. Fast engine + results — tier-1 packing in a worker; results panel (verdict /
      count / binding constraint / utilization); packed 3D view; vitest coverage for
      grid math, unit conversions, weight cap
      (ADR-0003 phase 5 engine + worker; ADR-0009 auto-run. Estimates follow the
      inputs — no compute button; results pinned as a panel footer; packed view
      instanced per part; max-quantity unit picker. Dogfooding through the real UI
      caught a unit-conversion off-by-one in the weight cap — 5 lb / 0.01 lb
      reported 499 — now floored tolerantly and pinned by test.)
- [x] 5. Thorough engine — minimal OBB + rotation search; quality selector fully
      wired; nesting tier visible but disabled
      (ADR-0003 phases 3–4. The tier selector now runs end-to-end: switching to
      Thorough re-packs through the OBB provider and renders the composed
      rotations. Nesting stays visible-but-disabled from phase 2.)
- [x] 6. E2E harness + golden samples — Playwright `_electron.launch()` specs in
      `e2e/`; `samples/` golden parts with hand-computed expected results shared by
      unit, e2e, and dogfood layers (ADR-0005); DropZone keeps the picker path e2e
      depends on
      (16 specs: `smoke.spec.ts` is the deploy gate — boot, both import paths, and
      one test per hand-computed golden in `samples/goldens.ts`; `packing-ui.spec.ts`
      covers auto-run, truncated layouts, unplaced parts, the unit picker, the view
      toggle, persistence, and unit conversion. Green against BOTH `out/` and the
      packaged `linux-unpacked` binary. Written CI-ready: no fixed-size display
      assumed, SwiftShader confined to `e2e/harness.ts`. `xvfb` remains the one
      unmet CI prerequisite.)

## Next

- [x] 7. Persistence — better-sqlite3 in the main process behind IPC (ADR-0007):
      `configurations` (named presets) + `estimates` (history); save/load UI;
      migrations via `PRAGMA user_version`; open-with-recovery
      (ADR-0007 shipped in six plan phases. **ADR-0013 supersedes its prebuild
      assumption**: the pinned version both ADRs named is not on npm and no npm
      release has an Electron-ABI-148 prebuild, so better-sqlite3 is compiled
      from source — `npmRebuild` + `buildDependenciesFromSource`, with Windows
      compiling under MSVC in CI. Packaging hid three separate silent failures
      that each shipped an unloadable module; `e2e/native-module.spec.ts` now
      guards them. The DB tests caught a data-loss bug where a database written
      by a newer build was quarantined instead of refused. Save/load UI plus
      auto-recorded history, keyed on a SHA-256 content hash so history survives
      a rename.)
      — carry-in **resolved by ADR-0016** (see item 11): history volume under
      auto-run. Implemented literally on purpose at ship time; the answer turned
      out to be explicit save, not the collapse-consecutive-rows guess this
      carry-in originally recorded.
- [x] 8. Installers + /deploy live — electron-builder: Windows NSIS (primary) +
      linux-unpacked smoke target; `/deploy` skill runs end-to-end (packaged smoke,
      dist-live staging, dogfood handoff); mac build documented
      (`/deploy` runs end-to-end and shipped its first build at 1ccc1fc: 143 MB
      Windows zip + linux-unpacked smoke target from one build, 16/16 e2e green
      against the PACKAGED binary, staged to `dist-live/` with rollback.)
      — carry-in **resolved by item 10**: the NSIS `Setup.exe` now exists, built
      natively on `windows-latest` (102 MB, first produced 2026-07-25 for
      `v0.1.0`). It is still unsigned, so SmartScreen warns on first run; code
      signing is the open piece, deferred until a certificate exists.
      — carry-in: **mac dmg still undocumented and unbuilt.** ADR-0012 declines a
      macOS runner on purpose — a dmg nobody can dogfood is an untested artifact
      wearing a ship label.
      **Re-examined 2026-07-27 with a Mac now available, and deferred again for a
      different and stronger reason: an unsigned mac build is not distributable.**
      On Windows, unsigned means SmartScreen warns and the user clicks through
      (item 10's carry-in). macOS has no equivalent click-through: Gatekeeper
      refuses an unsigned downloaded app outright and says *"Carton Fit is damaged
      and can't be opened"* — which reads as a corrupt download, not a signing
      gap — and the reliable fix is `xattr -cr` in Terminal, narrowed further in
      Sequoia. Shipping a dmg whose install instructions begin with a shell
      command is worse than shipping no dmg. Notarization needs a paid Apple
      Developer account ($99/yr) with no cheaper tier, so unlike the Windows
      certificate this cannot be half-done.
      So the blocker moved from *verification* to *funding*, and the build itself
      was never the hard part — `electron-builder.yml` already carries a
      `mac: target: dmg` block; what is missing is a `macos-latest` job in
      `release.yml`, which is an afternoon whenever the certificate exists.
      Revisit when an Apple Developer account is funded — the same trigger as the
      Windows signing carry-in, and worth doing together. Separate dmgs per
      architecture was the preferred shape if it ever happens (arm64 is what
      `macos-latest` builds; an arm64-only dmg will not launch on an Intel Mac).
- [x] 9. Polish — error states, app icon, window state persistence (ADR-0014)
      (All six slices shipped 2026-07-25; README.md written at close, with the
      recovered icon as its hero.)
      Scoped 2026-07-25 against what actually exists:
      - [x] **open-mesh volume warning** — shipped as **ADR-0015** (flag an
        unmeasurable input, do not refuse the estimate). `isClosedMesh` had been
        written and tested in item 2 but never called, so density mode over an
        open mesh reported a wrong weight silently — and weight is a hard
        constraint, so it became a wrong part count stated with full confidence.
        `openMeshParts` now gates it, scoped to the parts actually packed and
        skipped outside density mode; the results panel qualifies the whole
        answer, not just the weight line. New golden `cube-10x10-open.stl` (the
        cube minus its +z face: perfect 10 mm bbox, 666.67 mm³ instead of 1000 —
        33% light) pins it at the unit, golden, and e2e layers, and the e2e was
        mutation-tested to prove it can fail. Last known silent-wrong-answer
        path in the product, now closed.
      - unparseable-file errors and pack failures are ALREADY surfaced
        (`ImportResult`, `ResultsPanel`) — the item text was stale.
      - [x] **`storageError` visible outside the configurations panel** —
        `StorageBanner` is pinned above the scroll region, so it shows whether or
        not that panel is on screen; the panel's own copy is gone, leaving one
        canonical place. Two things surfaced while doing it: **history failures
        only ever reached `console.warn`**, so VISION's "every estimate is
        recorded" could silently stop being true, and the banner text leaked
        Electron's IPC wrapper (`Error invoking remote method '…': Error: …`)
        over the sentence actually written for the user — `storageMessage`
        strips it. Reported on every failure rather than once, because
        `setConfigurations` clears `storageError` on any success and a
        report-once warning could be erased while still true. E2E breaks storage
        the way a real downgrade does (stamping `user_version` 999 straight into
        the SQLite header, since better-sqlite3 in the test process has the wrong
        ABI) and asserts the banner stays in view at both scroll extremes;
        mutation-tested.
      - [x] app icon — wired in `electron-builder.yml`, verified by extracting
        the icon resources back out of the packaged `.exe` (7 sizes, 16→256).
        The source art needed real work first: it was **not transparent** (the
        checkerboard was painted into the image), carried a generator watermark,
        and filled only 63% of its canvas. See `build/ICON.md`; the unprocessed
        art is kept as `build/icon-source.png`.
      - [x] window state persistence per ADR-0014 (JSON in userData, NOT SQLite
        — bounds are needed before the lazily-opened database exists). Size,
        position and maximized survive a restart; bounds are validated against
        the displays attached RIGHT NOW, so a position on an unplugged monitor
        is dropped rather than opening the window somewhere unreachable. A
        corrupt or hand-edited file falls back to defaults field by field.
        Implementing it surfaced a real bug that "does it restore?" would never
        have caught: the window crept +6,+27 EVERY launch on WSLg, because the
        reported position includes the window frame but the constructor's does
        not — twenty launches walked it off the screen. See ADR-0014's
        consequences; the e2e guard is three launches, mutation-tested.
      — carry-in **closed as WON'T DO** (2026-07-25): translucent carton walls.
      Prototyped and screenshotted before deciding, both sparse (one 10 mm cube
      in a 12 in carton) and dense (343 cubes in a 3 in carton). Dense is
      pixel-identical — the parts occlude every wall. Sparse gains a tint so
      faint it takes flipping between the two images to see. The technique is
      fighting the dark theme: a translucent wall can only tint toward
      slightly-lighter grey, and the opacity needed to read clearly is the
      opacity that hazes the parts behind it. Depth already comes from the
      shaded parts, not the container. VISION amended to say wireframe, so this
      stops reading as unfinished work.
      - [x] **the installer shipped the 7.6 MB OCCT wasm twice** — fixed, and it
        was the smaller half of the problem. electron-builder includes
        production deps whatever the `files` list says, so the app carried all
        12 MB of occt-import-js (duplicate wasm, C++ sources, 3.9 MB of tests)
        AND all 28 MB of better-sqlite3 (the sqlite3 amalgamation, plus 15 MB of
        compiler object files), against 54 KB and 2.2 MB actually used at
        runtime. Exclusions are written as removals, never an allow-list,
        because the pruned copy carries the LGPL texts ADR-0011's notices cite
        by name — an over-broad exclude here is a licence violation, not a size
        win. **MEASURED: install footprint 62 MB → 35 MB; the Windows zip only
        141.7 MB from 149.3 MB, because C++ sources compress to nearly nothing
        while the wasm is incompressible** — so the download win really is just
        the duplicate wasm, and the other 20 MB is disk after install. Verified
        by the full packaged e2e (30/30, STEP import and storage both exercise
        the pruned tree) and both ADR-0011 compliance checks.
- [x] 10. CI + GitHub releases — **owns the Windows `Setup.exe`** (ADR-0010). A GitHub
      Actions matrix builds each platform on its own runner: `windows-latest` produces
      the NSIS installer natively (no wine) and compiles native modules with MSVC when
      no prebuild matches, which also de-risks item 7. Publish installers as release
      artifacts on tag; `/deploy` then fetches the CI artifact for a sha instead of
      building it. Prerequisites already known: the runner needs **`xvfb`** (no WSLg
      there) plus the SwiftShader flags already in `e2e/harness.ts`; vitest and
      typecheck need nothing special. Reuse `/deploy`'s staging semantics rather than
      duplicating them.
      (Shipped 2026-07-25 as ADR-0012, five plan phases. `ci.yml` verifies every
      push — typecheck, vitest, packaged e2e under `xvfb` — and `release.yml`
      builds the `Setup.exe` natively on `windows-latest`, self-verifies there,
      builds the Linux AppImage, and attaches both to a **draft** release; a
      human publishes. The version gate and the draft-only rule were each proved
      by exercising their negative path, not by reading the YAML. Windows found
      a real harness bug on its first run — `ELECTRON_RUN_AS_NODE: ''` selects
      node mode there, because Electron tests presence, not truthiness. `/deploy`
      now fetches the CI artifact for a sha instead of building.)
      — carry-in **discharged**: both ADR-0011 checks now run on the Windows
      build every release, and both were verified capable of failing.
      `scripts/check-asar-integrity-fuse.mjs --self-test` mutates the fuse and
      requires the checker to notice; `e2e-compliance/` mutation-tests the LGPL
      substitution spec. Result: electron-builder *embeds* integrity hashes on
      Windows but Electron does not *enforce* them, so the relink guarantee
      holds on the ship platform.
      — carry-in: **code signing.** The `Setup.exe` is unsigned, so SmartScreen
      warns. ADR-0010 says certificates belong on this same runner; revisit how
      they are held before adding it.

- [x] 11. Saved estimates + input undo — **ADR-0016**, shipped 2026-07-25.
      History records on EXPLICIT save, not auto-run: the placeholder "collapse
      consecutive rows" answered the wrong question — dedup removes repetition,
      not noise, and nothing marked which row the user meant.
      - Save-estimate action in the results header (`storage/estimates.ts`),
        disabled while a re-pack is in flight so a superseded answer cannot be
        filed. `renderer/storage/history.ts` and its exactly-once machinery
        deleted; the auto-record e2e rewritten to assert the opposite, plus a
        regression spec proving three carton edits add NOTHING to history.
        Same row shape, same IPC, no schema change, no migration.
      - `SavedEstimatesPanel`: browsable list with one-line summaries
        ("500 fit · 12×12×12 in · weight-limited"). `packing/summary.ts` is
        defensive by design — rows are JSON written by older builds, so a
        missing or wrong-typed field degrades the sentence instead of throwing.
        Restore loads SETTINGS only; the e2e proves the result is recomputed
        (27,000 → 343 → restore → 27,000), never replayed.
      - Undo/redo (`history/undo.ts`): bounded in-memory stack, coalescing keyed
        on a change signature that names the changed ARRAY INDEX, so typing
        "125" into one dimension is one step but length-then-width is two. The
        keyboard binding is split from the tracking so the subtle half unit-tests
        without a DOM. Ctrl+Z inside a text field is left to the browser.
      - Vocabulary split: **Presets** ("reusable carton setups — no part
        attached") vs **Saved estimates**.
      — carry-in **resolved by ADR-0017 / item 12** (2026-07-25): dogfooding
      produced the real request the deferral was waiting on. Copy-summary,
      measurements CSV and packed-view PNG are item 12; PDF stays deferred.
      — **dogfood finding (2026-07-25), fixed**: Ctrl+Z was dead after a spinner
      click. The steps WERE recorded — but focus stays in the number input, and
      the routing rule deferred every editable field to the browser, whose undo
      buffer holds only TEXT edits; a spinner step left the browser with nothing
      to undo and the app forbidden to act. Number inputs now keep app undo
      (which subsumes native undo there, since every keystroke commits and
      coalesces); real text fields like the preset name still defer. ADR-0016 §2
      amended; e2e drives ArrowUp-then-Ctrl+Z with focus still in the field,
      mutation-tested against the old rule.
      — **dogfood finding (2026-07-25), fixed**: both lists were written with
      `className="panel"` — the LEFT COLUMN's own class, carrying `width: 360px`
      and a `border-right`. Nested inside that same 360px column, which already
      spends 1.5rem on padding, they overhung both edges by ~24px and put a
      horizontal scrollbar on the inputs column. Every functional spec passed
      throughout — the controls were present, clickable and correct, just 24px
      into the margin. Now `.panel-section` (full width, `.inputs` spacing, and
      its `h2` folded into the same uppercase-label rule as CARTON and
      CLEARANCES). `e2e/panel-layout.spec.ts` guards it by RELATIONSHIP rather
      than pixel value — the column must not scroll sideways, and sections in
      one column share one left edge — and was mutation-tested by restoring the
      old class.
      — **e2e isolation bug found and fixed here**: window persistence (ADR-0014)
      had made the suite stateful, and a dogfooded maximized-on-second-monitor
      window made the packaged run take 12.2 minutes instead of 53 s WITH
      NOTHING FAILING. `launchApp` now gives every launch its own temp profile.

- [x] 12. Export — **ADR-0017**, shipped 2026-07-25 in six slices: copy summary
      + measurements CSV + packed-view PNG, all derived from the live
      request/result pair; warnings travel with every export (ADR-0015 extended
      past the app boundary); one `export:save` IPC in main (dialog + write
      bytes). PDF and bulk export stay out — see the ADR's revisit triggers.
      - [x] **summary + CSV builders** (`export/`) — pure derivation, 24 unit
        tests against hand-computed numbers. Every phrase that also appears on
        screen comes from `packing/verdict.ts`, so the email cannot start
        disagreeing with the app; `truncatedLayoutNote` moved there from inline
        JSX because the export needs the same sentence.
      - [x] **copy summary button** — clipboard write, same readiness guard as
        Save estimate (a stale estimate copied silently would have nothing to
        notice the mistake by).
      - [x] **export IPC** — `export:save`: main shows the dialog and writes
        bytes, the renderer decides what the bytes are. Cancel and write
        failures come back as DATA, never a rejected invoke — that wrapper
        (`Error invoking remote method '…'`) is the one item 9 had to strip out
        of the storage banner, so this channel never generates it.
      - [x] **save CSV button** + [x] **save PNG button** — PNG captured by
        render-then-read-back inside one call, no standing
        `preserveDrawingBuffer`; the button is disabled unless the packed view
        is actually showing. `viewport/capture.ts` is the seam: the island
        registers a capture fn while mounted, so three.js stays inside the
        viewport (ADR-0008) and the export module never imports it.
      - [x] **e2e** — 6 specs, dialog stubbed at the Electron layer (it is
        native) with real bytes on both sides. Both guards mutation-tested:
        emptying the warnings list fails only the qualifier spec, and dropping
        the render-before-read-back drops the PNG from 91.8 kB to 16.6 kB
        against a 20 kB threshold.
      — **the e2e caught a real bug the unit tests could not**: the CSV's
      Result cell went through `verdictHeadline`, which locale-groups, writing
      `Result,"27,000"` — parseable only because it was quoted, and still NaN
      to `Number()`. The count is the one figure in that file someone computes
      with. Now plain, pinned at both layers.

- [x] 13. Per-kind weight overrides — **ADR-0018**, shipped 2026-07-26 in six
      slices. Effective weight = override for the part's kind (base name before
      our ordinal suffix), else the current mode's answer; no third weight mode.
      File-scoped slice cleared on import (the `unitPartName` precedent), never
      in persisted settings. Renderer-only; no schema, IPC or migration.
      - [x] **kind grouping + effective weight** (`packing/kinds.ts`) — the
        suffix rule is the subtle part: ` (N)` is OUR uniquing, so it is
        stripped only when the base name is genuinely in the file. A CAD part
        named `flange (2)` with no `flange` beside it stays its own kind rather
        than being filed under a phantom group. Corrupt override values
        (negative, NaN, non-numeric) fall back to the computed weight — they
        round-trip through a saved estimate's JSON, so the shape is a claim.
      - [x] **store slice + warning skip** — `partWeightsG` cleared on import;
        auto-run watches it; `openMeshParts` skips overridden kinds, so taking
        the warning's own advice retires the warning.
      - [x] **Part weights panel** — one row per kind with count (`bolt ×6`);
        18 parts of the AS1 assembly collapse to 5 rows. Computed weight shown
        as a dimmed placeholder, so the default is visible without looking
        entered; clearing the field is how you get it back. Hidden entirely
        below 2 kinds, where the file-wide weight already says everything.
      - [x] **saved estimates round-trip** — overrides ride ALONGSIDE settings
        in the blob (inside would put them in presets and localStorage, which
        ADR-0018 §3 forbids); restore prunes to the loaded file's kinds.
      - [x] **undo coverage** — the snapshot carries both slices, with a
        `weight:<kind>` signature so bolt-then-nut is two steps.
      - [x] **e2e + export ripple** — 7 specs; the summary and CSV now say
        which kinds were corrected by hand, because "density × volume" alone
        is contradicted by a table it no longer explains.
      — **the existing undo test caught a real ripple**: restoring an estimate
      began writing two slices, and two store writes are two undo entries — so
      a restore silently cost two Ctrl+Z presses, against ADR-0016 §2's "one
      step". Fixed with a `restoreInputs` action that writes both in one `set`;
      undo's own apply uses it too, which also collapses two re-packs into one.
      — **asking whether the coverage gap mattered found a live bug.**
      `export/collect.ts` called `openMeshParts` WITHOUT the overrides, so every
      export carried "not a closed mesh, the weight is unreliable" for kinds the
      user had already priced by hand — in a document that outlives the window
      and cannot be argued with (ADR-0017 §2). The panel's call site was
      correct, which is exactly why nobody noticed: the two were only compared
      by eye. Root cause was the DEFAULT parameter, which made forgetting it
      compile; `overrides` is now required on `openMeshParts` — a type error
      beats a test — while `buildPackRequest` keeps its default because the
      same slip there is a wrong COUNT, which every count spec catches in
      seconds. `tests/export-collect.test.ts` covers the layer that had none.
      — coverage note: the warning-retires-on-override path is pinned at the
      UNIT layer (`part-kinds` and now `export-collect`). The e2e proves the
      alternative documented fix (switch to direct entry) because the only
      open-mesh golden is a single-kind file, and a single kind hides the panel.
      A multi-kind open-mesh STEP sample would let the e2e drive the real path;
      not built, because hand-authoring one risks OCCT sewing the open shell
      closed and the failure it would catch is a stale sentence, not a wrong
      number. Worth revisiting when a second reason for a mixed-material
      fixture appears.

- [x] 15. Update check + the header status area — **ADR-0021**, shipped
      2026-07-26. Two things the same decision, because adding a second banner
      is what exposed the first one's home as wrong.
      **Ordering constraint: this must land in 1.0.0 itself, before the draft is
      published.** An installed build with no update check can never learn that
      1.1.0 exists, so 1.1.0 could only announce itself to people already
      running a build that knows how to look. The window is open only while the
      release is still a draft.
      - **the check** — main process, on launch, after the window shows.
        `net.fetch` (no new dependency) against
        `/repos/LoganBresnahan/Carton-Fit/releases/latest`, which returns only
        published non-draft non-prerelease releases, so ADR-0012's human-publish
        gate is inherited for free. Compare `tag_name` to `app.getVersion()` as
        three integers — no `semver` package for a three-line compare.
      - **every failure is silence** — offline, DNS, a 403 from rate-limiting, a
        changed response shape, an unparseable tag. A packing estimator must
        never nag about the network. This is a contract, so it gets its own e2e;
        `UPDATE_CHECK_URL` lets the specs point at a local fixture.
      - **the banner is the whole UI** — one line, "Version X is available ·
        Download", opening the release page via `shell.openExternal` brokered
        through preload like every other privileged call. Nothing downloads,
        nothing installs, nothing blocks.
      - **both banners move to the header**, and `StorageBanner` leaves the
        360px control column. Item 9's requirement — a storage failure must
        never scroll out of sight — stops being an arrangement of flex siblings
        and becomes structural, since the header cannot scroll. Its existing
        e2e asserts a *relationship* (`toBeInViewport()` at both scroll
        extremes), so it should survive the move unedited and prove more than it
        did before. Storage outranks news when both are present.
      - **the header's height must not depend on its contents** — the update
        banner arrives asynchronously, and a header that grew when it appeared
        would shift the window under a moving cursor. Fixed height; messages
        truncate to a `title` tooltip rather than wrap.
      - **dismissal is per occurrence, not per banner** — no persisted state
        (ADR-0020 made the localStorage key a versioned surface). The subtle
        half is the re-arm: dismissal keys on an occurrence counter, never the
        message text, because two consecutive failed saves usually produce the
        *identical* string — exactly the case where the user has retried and
        most needs telling. Deleting the re-arm must fail one spec and nothing
        else.
      — **release mechanics, verified 2026-07-26**: the draft does NOT need
      deleting. `v1.0.0` is pushed and annotated (peels to 69aabd8), and
      `release.yml`'s `draft-release` job is create-or-update — it clobbers the
      existing draft's assets by name. So: land this, `git tag -f v1.0.0` and
      force-push, and the workflow rebuilds in place. Asset names are stamped at
      `1.0.0` and unchanged, so the clobber leaves no orphans (it would not if
      the version moved). **Two notes-shaped traps**: the re-run path never
      touches release notes, so `.github/release-notes.md` — whose known-
      limitations list currently ends "No auto-update." — needs editing here
      *and* applying to the live draft by hand
      (`gh release edit v1.0.0 --notes-file …`). The `api.github.com` contact is
      a user-visible behaviour change, so it belongs in CHANGELOG **under
      `[1.0.0]`, not `[Unreleased]`** — it ships inside that release.
      — **the specs are PACKAGED-ONLY, and finding out why was the one real
      surprise.** In a dev run `app.getVersion()` returns **`"0.0"`** — Electron
      falls back to that when the main script has no adjacent `package.json`,
      which is exactly the shape of `out/main/index.js`. Two components do not
      parse, so the check correctly says nothing, and every one of the five
      specs passed VACUOUSLY against `out/` — the silence ones included, since
      they assert an absence that dev produces for the wrong reason. This is
      ADR-0005's rule arriving in a new disguise: not a packaged-only *failure*
      but a packaged-only *capability*, where dev green means nothing at all.
      Marked `test.skip(!PACKAGED_APP)` with that written down, like the storage
      specs.
      — both guards mutation-tested, each failing exactly one spec and no
      others: making dismissal permanent (`dismissedStorageSeq` pinned to
      MAX_SAFE_INTEGER — a plain dismiss button, which is the alternative
      ADR-0021 §9 rejects) fails only the re-arm spec, and making
      `isNewerVersion` always true fails only "the current version is not
      announced". The second matters because a banner that never consulted the
      compare would still have passed the found-an-update spec.
      — the renderer never learns the URL. `openReleasePage()` takes no
      argument, so it can ask main to open the page main fetched but cannot
      nominate one; a renderer-supplied URL would make `shell.openExternal` an
      open-anything launcher reachable from page content. The e2e stubs
      `shell.openExternal` in main and asserts the app's own window never
      navigated.
      — **looking at it found what every functional spec missed**, the same
      shape as item 11's 24px overhang. Both chips shrank proportionally, so at
      an ordinary 1280px window "Version 1.4.0 is available" collapsed to
      "Versi…" — losing the version number, the update chip's entire actionable
      content — while the storage sentence beside it kept every character; at
      720px the chip was clipped mid-word with its dismiss button off-screen and
      unclickable. The news chip no longer shrinks and storage absorbs all the
      truncation. **ADR-0021 §7 amended**, because its justification for
      truncating ("the tint and the label survive") is true of prose and simply
      does not transfer to a message that is one number. Guarded by relationship
      at 720px: the version readable, both controls in the viewport, dismiss
      actually clicked.
      — one network request per LAUNCH, not per renderer load: main memoizes the
      promise. The e2e harness reloads the page on every launch, so a per-request
      check would have quietly doubled the traffic and made the 60/hour limit a
      function of how often a window reloads.

- [ ] 19. Tier 3: drop-in packing — **ADR-0023, still Proposed**. Voxelized
      geometry dilated by clearance, an insertion-order constraint (each part must
      drop into place past the parts already there), warm-started from tier 2 so
      it is monotone and anytime; the witness is packing *instructions* — an
      ordered (part, orientation, position) sequence the viewport can animate.
      That witness is the product payoff, and it survives even when the fill gain
      over tier 2 is small.
      **This is the frontier, but it is gated twice and neither gate is ours to
      wave through:**
      - the ADR is Proposed, not Accepted — its five **open details** (voxel
        resolution + memory bounds, the insertability model, the move set, where
        the ratchet cache lives, and WASM/Rust vs. worker-side TypeScript, which
        ADR-0011's lean-dependency rule makes a real decision) must be resolved
        first. `adr-plan` runs *after* the flip to Accepted, not before.
      - ADR-0003's tier-3 trigger is what funds it: **users routinely packing
        concave parts where nesting would change the answer.** Dogfooding
        supplies that evidence or it does not. ADR-0023's own second revisit
        trigger points the other way — if typical clearances run at or above
        ~10 mm, dilated parts converge back to their boxes and the better move is
        promoting the packing-instructions animation to tiers 1–2, whose
        placements are already sequences.
      So the next action here is **evidence, not code**: dogfood real concave
      parts at real clearances and see which trigger fires. On acceptance this
      also amends VISION's tier list and ADR-0003's tier-3 line, and grows the
      result schema with sequence data — a contract change for storage, export
      and the viewport.
      — **evidence note (2026-09-01): first live specimen of the funding
      trigger, from outside the app.** A shared claude.ai transcript (the one
      that produced ADR-0028/0029): a real engineer's ⊥-shaped ribbed casting,
      49.8% of its own footprint rectangle, where flipping alternate parts 180°
      meshes the footprints and raises a layer from 80 to 120 parts — +50%,
      found only on the third verification pass, and invisible in principle to
      any bounding-box tier. Notably it survives the ADR-0023 counter-trigger:
      the gain persists at handling clearance (~100–110/layer, features are
      inch-scale), weight never bound, and the arrangement is trivially
      top-down insertable — it is *in-plane* interlocking, exactly drop-in
      packing's easy case. The transcript's own caveat ("an operator flips
      every other part — price that labor") is the packing-instructions
      witness's argument made for us. Still one data point against a trigger
      that says "routinely"; the gate holds, but ADR-0029's surface would turn
      conversations like this into a standing evidence channel.

- [ ] 21. Claude can drive Carton Fit — **ADR-0029, Accepted 2026-09-01**.
      The app hosts an MCP stdio server for Claude Desktop (confirmed
      client); Claude keeps the judgment layer, the engine supplies every
      number. Designed 2026-09-01 down to a three-tier tool surface: **v1**
      inspect the engine (`inspect_model` + `estimate`, stateless, proven
      against the goldens as their third consumer), **v2** drive the live app
      through the store's own actions (`load_model`, `set_inputs` under
      auto-run, `get_estimate`, `capture_view` returning the packed view as an
      image Claude can see; Ctrl+Z steps back the AI's changes like anyone
      else's), **v3** presets/saved estimates/exports. Resolved along the way:
      bundled distribution via `ELECTRON_RUN_AS_NODE` (LGPL story unchanged —
      same unpacked wasm, same notices, same compliance suite), occt proven
      under plain Node by spike, paths not bytes, units explicit on the wire
      both directions, window hidden until the first drive call, stdout
      protocol-only. Bulk questions answer per ADR-0028: ceiling + fill-trial
      guidance, never a count. Versioning: one number — tools/schemas join the
      app's ADR-0020 surface (additive = minor, breaking = major, staged builds
      say `+sha` per ADR-0027 in the server-info handshake). Launch-order
      independence via `--mcp` shim + single-instance named pipe: connect to
      the running app if one exists, else boot hidden; a manual launch while
      the hidden server runs shows *that* instance's window. Build plan:
      `doc/plans/adr-0029-mcp-build-plan.md` (14 slices, 6 phases — four opus
      sittings, two fable; adversarial verify reserved for units, qualified
      schema, the v2 settle protocol, and the shim).
      **Phase 1 landed 2026-09-01** (both foundation slices): the MCP SDK is a
      runtime dependency with its notices row, and `src/main/occt/` reads STEP
      files from disk in the main process — the same `extractParts` adapter, the
      same protocol parts, the same goldens, and deliberately the *same shipped
      wasm* the viewport loads, which turned out to be an ADR-0011 question
      rather than a wiring one (addendum in ADR-0029). Proven on the packaged
      build, and `electron-builder.yml` was not touched.
      Two carry-ins for later phases, both about what packaging prunes:
      - **the SDK's 61 transitive packages (26 MB) all ship, and a stdio server
        loads 8 of them** — the rest are an express/hono HTTP stack. Compliant
        today (every one permissive, every one shipping its licence text) but
        26 MB of dead weight in a dogfooder's download. Prune at
        `mcp-server-host`, the first slice that imports the SDK.
      - ~~**STL cannot be read from the main process**~~ — **resolved in phase 2**:
        it can, by bundling ~330 KB of three into out/main. Five of the six golden
        packing scenarios are STL, so the fixture layer settled it.
      **Phase 2 landed 2026-09-01** — the v1 tool surface exists and is proven.
      `inspect_model` and `estimate` are thin adapters over seams that already
      existed (no new packing or geometry logic), driven in tests through a real
      MCP client over the SDK's in-memory transport, and asserted against the
      hand-computed `samples/goldens.ts` — the tools are now those goldens' third
      consumer alongside the unit math and the e2e specs (ADR-0005). Both
      adversarial verify passes ran and both found something: the units pass
      caught its own blind spot under mutation (a doubled output conversion it
      could not see, because the only value it checked was a clamped zero), and
      the qualifications pass proves structural requiredness three ways —
      published schema, deletion mutation, and behaviour. 704 tests green.
      Two contract decisions worth knowing about, both in ADR-0029's phase-2
      addendum: a call carries no `units` field at all (every value is a
      `{value, unit}` pair, so ADR-0024's decoupling is structural rather than
      remembered), and an optional figure crosses as `{known:false, reason}`
      rather than an absent key — so "there is no upper bound" and "this build
      forgot it" stop looking the same.
      ~~Carry-in re-pinned to phase 3: the ambient `occt-import-js.d.ts` still sits
      in the renderer tree while typing main's code.~~ — resolved in phase 3
      (moved to `src/types/`).
      **Phase 3 landed 2026-09-01** (both fable slices) — the server RUNS, two
      ways, and Claude can drive the app:
      - `mcp-server-host-in-main`: `out/main/mcp.js` serves v1 headless via
        `ELECTRON_RUN_AS_NODE` (from inside app.asar — proven against the
        packaged bytes), and `--mcp-server` hosts the same server in the app's
        main process beside a live window. Both modes derive appPath/version
        from `__dirname` through one rule, never from `app` (which reports
        "0.0" under an e2e launch — the ADR-0021 trap again). The SDK-pruning
        carry-in is discharged: SDK → devDependencies + rollup-bundled stdio
        subset, app.asar 17 → 9.5 MB, licences inline in the notices file, and
        a bundled-modules manifest + spec that turns a future
        bundled-but-uncited package into a red test. All three licence guards
        mutation-tested.
      - `v2-drive-tools` (adversarial verify, as planned): six tools through a
        new main→renderer bridge, everything via the store's own actions (one
        AI edit = one undo step). The settle protocol is event-ordered — dirty
        raised by input writes, lowered only by a pack BEGINNING — because a
        completion can belong to old inputs while a dispatch cannot; the named
        race (get_estimate returning the previous result) is pinned at unit
        and e2e layers and was mutation-tested (naive settle flips exactly the
        two count specs). The verify pass also caught a v1 qualification lying
        (overrides-only estimates said "no weight given, cap could not bind"
        while being weight-bound) — fixed in the shared report assembly.
      92 packaged e2e, 721 vitest green twice.
      **Phase 4 landed 2026-09-01** (all four opus slices) — the server grows a
      lifecycle, a data tier, and an honest name:
      - `stdout-protocol-discipline`: stdout is TAKEN rather than asked for —
        the real `process.stdout.write` is captured for the transport and every
        other write to that stream goes to stderr, so a future direct write
        (the case a `console.log` redirect misses) cannot corrupt a frame.
      - `hidden-launch-show-on-drive`: `--mcp-server` launches hidden and
        reveals on the first drive call, because Claude Desktop starts its
        servers when *it* starts. All three lifecycle interactions decided: the
        update check follows the window (a hidden server never phones GitHub),
        `window-all-closed` carves out server mode with a window rebuilt on
        demand — which made the bridge's readiness a property of a page and
        discharged phase 3's reload race — and `backgroundThrottling: false`,
        the trap nobody named: a `show: false` window is a hidden page whose
        timers throttle and whose rAF stops, fatal for a mode that idles for
        hours then gets driven. Both directions of the quit rule are pinned and
        mutation-tested.
      - `v3-data-tools`: SEVEN tools, and deliberately not eight. Reads answer
        from main's own database; writes and restores ride the bridge into the
        renderer's own functions, so ADR-0016's one-restore-one-undo-step and
        ADR-0018's override pruning are reused rather than restated. Deletion is
        absent on purpose and pinned by a test — everything else here is
        recoverable and a deleted preset is not.
      - `one-version-handshake`: ADR-0027's `+sha` rule, applied to the
        handshake. Composed at build time and living ONLY on that wire, because
        `version.ts` rejects a build suffix by design — stamping the version at
        its source would buy a truthful handshake by silencing the update check.
      ~~**CARRY-IN — `--mcp-server`, the APP-HOSTED server, does not work on
      Windows.**~~ — **resolved by phase 5** (below), after a fourth CI run
      (33644585849, the probe branch) CORRECTED the diagnosis: it is stdin,
      not stdout. A raw probe showed the GUI process's stdout carrying both a
      stream-written and an fs.writeSync frame to the parent perfectly, while
      the initialize written to its stdin was never delivered — a GUI-subsystem
      Electron main process on Windows can speak but never hears. The stray
      CRLF the first three runs fixated on is boot noise. The headless entry
      works because run-as-node is a plain Node process. So no stdio hosting
      can work there in either direction that matters, and the shim — headless,
      where stdin works — is the mechanism, not a workaround. The app-hosted
      stdio spec is skipped on win32 with the finding as its stated reason;
      the same drive behaviours run on Windows through the shim.
      **Phase 5 landed 2026-09-02** (the fable batch B slice,
      `mcp-shim-single-instance` — the plan's highest-risk slice, and after
      the Windows finding its most load-bearing):
      - `--mcp` on the headless entry is the SHIM: a dumb byte proxy from the
        client's stdio to the app's per-profile pipe, spawning a hidden app
        when none is listening (detached — it must outlive the shim) and
        passing its own argv through to it. Races settled by not entering
        them: racing shims both spawn, the apps race the single-instance
        lock, the loser exits, both retry loops land on the winner. Mutation
        testing showed the redundancy is real — an always-spawn mutant still
        converges to the person's instance through the lock.
      - EVERY launch serves the pipe (launch-order runs both directions: open
        the app, then ask Claude, and Claude reaches the window you are
        looking at — pinned by a spec that loads a part through the UI and
        reads it back through the shim). One instance per profile via
        Electron's lock; a second manual launch reveals the hidden window,
        focused, and exits.
      - Quit policy (the ADR's punt, answered): the shim's life is the
        client's; the app's is its own. Quit mid-session → shim EOF → next
        question boots fresh. A server-mode app quits ITSELF when its last
        stay-alive reason goes (stdio client, pipe sessions, visible window —
        event-driven), closing its listener first so a shim dialing
        mid-teardown gets refused and spawns fresh; a revealed window keeps
        it alive on purpose (a person may be reading what Claude did). A
        60 s backstop covers a shim that died before connecting.
      - The drive/data e2e specs now ride the shim — the transport users get,
        and the one that exists on Windows. Server-mode apps write
        `<userData>/mcp-server.pid` so the harness can stop a detached app.
      103 packaged e2e, 763 vitest green twice on Linux; the Windows verdict
      is the release.yml run for this sha. Next: phase 6, the Connect to
      Claude button — the config it writes is exactly the shim invocation
      these specs drive.
      — a second, smaller CI catch, already fixed (5a8a462): the build id asked
      git twice per build and vite's own transient config file made the two
      readings disagree, so a CLEAN checkout stamped `+<sha>-dirty`. At a
      release tag that would have inverted ADR-0027 — the one build entitled to
      a bare number introducing itself as a snapshot. Unfindable on this dev
      box, where the tree was dirty and both readings agreed.

## Later

- [x] 14. Slim the packaged app, second pass — **shipped 2026-07-26: Windows
      `resources/` 59 MB → 13 MB, a 46 MB (78%) cut**, confirmed by unpacking
      the CI artifact rather than by trusting the config. `app.asar` 25 → 4 MB,
      the unpacked tree 34 → 10 MB, and the whole installed app dir 406 → 360 MB
      (the remainder is Electron and Chromium themselves).
      **The download win is a seventh of that**, exactly the asymmetry item 9
      warned about: `Setup.exe` 106.5 → 98.9 MiB and `win.zip` 148.1 → 137.5 MiB,
      about 7% each. What was removed compresses well — minified JS and compiler
      binaries — while the 7.25 MiB OCCT wasm that dominates the archive does
      not compress at all.
      Original scoping, measured 2026-07-25 by unpacking the CI artifact for
      `698a968` — its "~40 MB" headline undercounted; the true figure was ~49 MB:
      - MSVC build intermediates left in `better-sqlite3/build/`, none of which
        any runtime path opens: `better_sqlite3.iobj` (14 MB),
        `sqlite3.lib` (6.9 MB — a build *input*), `better_sqlite3.ipdb`
        (3.4 MB), plus `.exp`/`.lib`/`test_extension.*`/`.vcxproj`. Only
        `better_sqlite3.node` (1.9 MB) is loaded. The existing exclusions name
        the gcc artifacts (`obj`, `obj.target`, `.deps`, `*.mk`) and simply do
        not match MSVC's names.
      - `three` (17 MB) and `react-dom` (7.1 MB) ship as node_modules copies
        although vite bundles both into `out/renderer`. **Proof they are
        unreachable: the only bare `require()` anywhere in the shipped `out/`
        tree is `better-sqlite3`** (plus `electron` and node builtins).
      Carry the item 9 rule forward unchanged: exclusions are written as
      REMOVALS, never an allow-list, because the pruned copies carry the LGPL
      texts ADR-0011's notices cite by name — an over-broad exclude here is a
      licence violation, not a size win. Verify by re-running the packaged e2e
      AND both compliance checks on Windows, then re-measure the artifact
      rather than trusting the config. Report the download delta separately
      from the install delta: item 9 found C++ sources compress to nearly
      nothing, so a big install win can be a small download win.
      - [x] **exclusions written and locally verified** (2026-07-26). Both
        halves are in `electron-builder.yml` as removals.
        **`resources/` on Linux: 35 MB → 13 MB**, `app.asar` 25 MB → 3.2 MB,
        its `node_modules` 28 MB → 4.3 MB. 65 packaged e2e green, plus the
        LGPL substitution compliance suite.
      — **two corrections to this item's own text, both found by measuring.**
      First, "what survives is Windows-specific" is only half true: `three` and
      `react-dom` sit in `app.asar`, which is platform-neutral, so they were in
      the LINUX build too at exactly the sizes quoted above — 24 MB of the win
      needed no Windows runner at all. Only the MSVC output is Windows-only.
      Second, the real total is ~49 MB rather than "~40 MB" (the item's own
      bullets already summed to ~48).
      — **the obvious implementation would have been a licence violation.**
      "three and react-dom are unreachable, exclude them" deletes
      `node_modules/three/LICENSE` and `node_modules/react-dom/LICENSE` — and
      THIRD-PARTY-NOTICES.md, which ships INSIDE the app, states "Each
      component's full notice ships with it inside the application archive".
      Pruning does not retire the MIT obligation either, because the code still
      ships, bundled into `out/renderer` by vite. So the exclusions name the
      code directories only (`three/{build,src}`, `react-dom/cjs`) and every
      `LICENSE` stays. Item 9 wrote this rule down for the LGPL texts; it turns
      out to bind the permissive ones just as hard.
      — **`e2e/licence-notices.spec.ts` is the standing guard**, because nothing
      else could catch this: deleting a licence text breaks no feature and
      fails no other spec. It parses the components out of the notices table
      itself — so a package added there starts being checked without anyone
      remembering — and asserts each ships a non-empty licence file, plus the
      three occt paths ADR-0011 cites by name rather than by URL. It reads
      app.asar's index directly (four uint32s, then the JSON directory, which
      carries each file's size) rather than using `@electron/asar`, which is
      only a transitive dependency of electron-builder: a licence guard should
      not stop working because an unrelated package reshuffled its tree.
      — **the MSVC globs were proven WITHOUT a Windows runner** by creating
      files with MSVC's exact names in `build/Release/`, packaging, and
      confirming the archive kept only `better_sqlite3.node`. That tests the
      pattern rather than the platform, which is the half that was actually in
      doubt — `*.{iobj,ipdb,lib,exp}` is a glob question, not a Windows one.
      - [x] **confirmed on Windows** (`workflow_dispatch` run 30232612301,
        2026-07-26): 65 packaged e2e green on the pruned bytes, plus the ASAR
        integrity fuse self-test and the LGPL substitution suite. `draft-release`
        skipped itself, so the `v1.0.0` draft was untouched — a dispatch builds
        and verifies but never publishes (ADR-0012). The artifact then measured
        13 MB against a 12 MB projection.
        The unpacked tree is now exactly what runtime needs and nothing else:
        the OCCT wasm (7.25 MiB, LGPL relink seam), `better_sqlite3.node`
        (1.85 MiB), and better-sqlite3's `lib/` + `LICENSE`.
      - [x] **CHANGELOG entry** written against those measured numbers rather
        than the projection.
      — not done, deliberately: the 36-package `prebuild-install` dependency
      tree still in the archive (1.26 MB). `bindings` and `file-uri-to-path`
      live in that same tree and ARE required at runtime by
      `better-sqlite3/lib/database.js`, so the removal list would have to keep
      distinguishing them correctly as the tree changes — a standing hazard
      priced well above 1.26 MB. Revisit if that tree ever grows something big.
- More import formats (OBJ, IGES — near-free via occt-import-js)
- [x] 16. Placement upgrade: extreme-point placement + EMS reporting inside tiers
      1–2 AND quantity mode, shelf/grid kept as incumbents, oracle, and crash
      barrier — **ADR-0022, shipped 2026-07-27** in the six phases of
      `doc/plans/adr-0022-placement-build-plan.md`. Accepted 2026-07-26 ahead of
      ADR-0003's dogfood trigger on purpose, and **that trigger is now
      discharged** in ADR-0003 itself.
      What the user gets: **fit check finds arrangements it used to miss** (both
      engines race, the better answer wins, so it cannot regress — improved a
      third of a 240-case generated sweep and worsened none), **max quantity
      mixes orientations** (1×1×2 blocks in a 3×3×3 carton: 9 → 13, which is the
      proven maximum), **a non-fit explains its stopping point**, and **a count
      now carries a rigorous upper bound** — the only packing figure in the
      product stated without a hedge.
      - [x] **phase 1** — the independent validator: an overlap/containment/
        clearance judge that shares no reasoning with any placer, because EP is
        the first placement code here that *can* be geometrically wrong.
      - [x] **phase 2** — the EP engine, plus a quantity upper bound proved
        rigorous against that judge.
      - [x] **phase 3** — the engine goes LIVE (fit check runs both and returns
        the better), the operation backstop, and the first generative suite in
        the repo. Both of the ADR's open measurement questions closed with
        numbers rather than argument: scoring rule deepest-bottom-left, backstop
        2e8 operations. The fuzz also **refuted the ADR's own "EP never places
        fewer" premise** (~1 in 300 inputs), which is why the invariant is
        asserted against the raced result — §2 amended accordingly.
      - [x] **phase 4** — EMS bookkeeping and quantity refinement, both
        adversarially verified: three executed refutations fixed and pinned, plus
        a fourth found outside the slice (`greedyShelfFit` was the last engine
        consuming clearances raw, and the phase-3 race was shipping the
        impossible arrangement that produced).
      - [x] **phase 5** — the crash barrier (throw / validator-rejected /
        backstop trip → the incumbent stands), the determinism suite, and §7's
        wording on screen and in both exports. Four decisions the ADR had left
        implicit were amended into it here, the subtlest being that a backstop
        trip discards in fit check but NOT in quantity mode, where §4 makes the
        same budget the bound on refinement cost.
      - [x] **phase 6** — docs: ADR-0003's placement description amended and its
        revisit trigger discharged, VISION's Output section carrying the two new
        user-visible facts, this check-off.
      — the two amendments worth remembering, because both were found by BUILDING
      rather than by reviewing: the fuzz refuted a premise the ADR stated as
      obvious (phase 3), and writing §7's sentence exposed a case its wording
      does not survive — on a weight-bound non-fit the leftovers usually fit the
      free space fine, so printing both triples under "Did not fit" reads as an
      app that cannot do arithmetic. The comparison is now gated on the part
      actually not fitting.
      — carry-in: **the barrier and the backstop are both dormant by design.**
      Either firing on a realistic carton is a defect, not a mode (§2), and only
      the differential fuzz can notice that they have started firing — a standing
      spec asserts the barrier keeps healthy EP output, because a barrier that
      discarded everything would satisfy every other test while deleting the
      whole ADR. If a dogfooded load ever reads as a hang, `DEFAULT_MAX_EP_OPS`
      is the tuning knob (§5), not a spinner.
      — deliberately NOT built: EMS as a second *placer*. It is carried for its
      reporting value alone and is the pre-declared cut if that stops paying
      (§3, and the ADR's revisit triggers).
- [x] 17. Weight units per input + typed number fields — **ADR-0024, shipped
      2026-08-26** from direct user feedback: the coupled `in / lb` toggle could
      not express "carton in inches, parts in grams", and the spinner arrows
      were disliked outright. `unitSystem` now governs lengths only; two new
      persisted fields (`maxWeightUnit`, `partWeightUnit`, each `g|kg|lb`) put
      a selector beside every weight input, with old settings blobs deriving
      them from their own toggle so no existing display jumps. Exports split
      the same way the panel does: per-part columns in the per-part unit,
      packed-vs-cap in the cap's unit. Spinner buttons hidden app-wide by CSS;
      keyboard arrows (which the ADR-0016 undo e2e drives) untouched.
- [x] 18. Theme: light / dark / system — **ADR-0025, shipped 2026-08-26** in the
      plan's 5 phases. Main owns `nativeTheme.themeSource` from a `theme` field in
      the ADR-0014 window-state file (read before the window exists, so the
      `backgroundColor` matches and nothing flashes); the stylesheet keys on
      `prefers-color-scheme` only; the viewport's four hex constants became a
      `viewportPalette(dark)` the island re-applies on change; the control is a
      three-way select in the header status area, held outside `settings` so
      presets and Restore never carry it. PNG export follows the theme (§5).
      Build plan: `doc/plans/adr-0025-theme-build-plan.md`.
      — **the e2e harness was measuring itself, and only a colour assertion could
      show it.** Playwright emulates `prefers-color-scheme: light` on every page,
      and that override outranks `nativeTheme.themeSource` — so the first run of
      the theme specs had main reporting `themeSource: 'dark'` while the renderer
      stayed light, which reads exactly like the feature being broken. A
      bare-Electron probe against our own built page proved the app right and the
      harness wrong; `launchApp` now clears the emulation beside the SwiftShader
      flags. This was never theme-specific — **any** future spec asserting a
      colour would have measured Playwright — so it was written into ADR-0005's
      harness-carries list rather than left as a code comment (bb874f8).
      — the five specs are mutation-tested against light and dark `backgroundColor`
      drift, `viewportPalette` drift, `themeSource` not applied, and the
      preference not persisted. The flash guard checks BOTH themes deliberately:
      pinning the opposite of the machine's resolved scheme is what keeps it
      non-vacuous under `xvfb`.
- [x] 20. Resizable control panel — **ADR-0026**, shipped 2026-08-26 in the
      build plan's four phases (`doc/plans/adr-0026-panel-build-plan.md`).
      (Added as a second "19" while the tier-3 item above already held that
      number; renumbered to 20 after it shipped, so the four commits that built
      it say "item 19".)
      Drag handle on the panel's right edge (double-click resets), `<` / `>`
      keyboard steps routed by ADR-0016 §2's rule extended to every editable
      element, no header buttons. Width is `--panel-width`, so the three
      historical 360px bugs' number is a parameter; clamped in one pure
      function that the drag, the keys, the reset and the window-resize handler
      all call; persisted in its own localStorage key outside `settings` (read
      synchronously so the first frame is right — the reason it is NOT the
      ADR-0025 window-state route), now named in ADR-0020's versioned surface.
      Two things the build turned up:
      — the routing predicate could NOT be `undo.ts`'s. Its near-twin
      deliberately excludes `type=number` (ADR-0016 §2, or Ctrl+Z is dead in
      the field it just changed) and ADR-0026 §2 needs the opposite, so reusing
      it would have silently imported the exception — the panel would step from
      inside a carton field and nowhere else. Duplicated on purpose, and the
      e2e presses `>` in both a text and a number field to say so.
      — the "canvas tracks the stage" line was vacuous as first written. The
      canvas's CSS box follows the stage through flex layout whether or not the
      ResizeObserver exists, so the spec passed with `observer.observe` commented
      out; it now asserts the DRAWING BUFFER, which is what
      `renderer.setSize(w, h, false)` actually sets. All seven panel specs were
      mutation-tested (width never saved, double-click dead, drag dead, resize
      handler removed, min bound moved, undo's predicate reused, observer not
      observing).
- Box tare weight; material density library (ADR-0004 revisit triggers)
- ~~Auto-update via electron-updater~~ — **superseded by ADR-0021 / item 15**,
  not deferred by it. The app now notifies and links; it deliberately never
  installs. Silent install is trust-negative while the installer is unsigned
  (it relocates the SmartScreen moment to one the user did not initiate), and
  electron-updater is a runtime dependency plus a server-side release contract
  sized for a cadence this project does not have. Becomes worth revisiting only
  behind a code-signing certificate — see ADR-0021's revisit triggers.
