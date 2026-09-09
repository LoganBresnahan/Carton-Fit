# Changelog

Notable changes to Carton Fit, written for someone *using* the app rather than
building it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and what it means for you. The reasoning behind each
change lives in its decision record under [`doc/adr/`](doc/adr/), linked inline;
build order lives in [`doc/roadmap.md`](doc/roadmap.md).

## [Unreleased]

### Added

- **Customers.** A *Working for* selector in the header holds the customer
  you are working for; *House* is the default and means everyone. Presets and
  saved estimates you save are tagged with it, the preset picker shows house
  plus that customer's cartons (other customers' under their own group), and
  the saved-estimates list shows the loaded model's receipts for that customer
  plus house, with *All* widening to everything. A customer is a name and
  nothing else, and nothing in an estimate depends on it: the same part in the
  same carton packs identically whoever you are working for. Creating one is
  done from the selector. The database schema moves to version 3; existing
  presets and receipts are house rows. An AI assistant can list customers,
  switch between them, and ask either list for one customer's rows or all;
  it cannot create one.
  ([ADR-0035](doc/adr/0035-customers-are-a-label-on-presets-and-receipts.md))

### Changed

- **An assistant can tell which inputs this session set.** The state reply
  lists the input groups changed since the app launched and says whether the
  rest are from an earlier session or the defaults. Eight dogfood readers had
  asked. ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md) amendment 1,
  [ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md) amendment 15)
  It also lists the groups *written* since launch, whether or not the value
  moved, so an assistant that sets an input to the value it already had can
  show it did. Undoing an edit does not count as writing one. Alongside, the
  saved-estimates tool's "all" scope now says it stays within the customer
  filter, which is its own switch.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md) amendment 2,
  [ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md) amendment 16)
- **A list tells an assistant how many rows the customer filter hid.** The
  preset and saved-estimate lists an assistant reads carry a count of the
  other customers' rows they left out, so two lists that differ only in label
  no longer read as one list.
  ([ADR-0035](doc/adr/0035-customers-are-a-label-on-presets-and-receipts.md) amendment 1,
  [ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md) amendment 17)
- **The bolt in the sample assembly is no longer called mixed.** The check
  for whether a part's instances sit at different orientations tolerated only
  a millionth of a millimetre, so the rounding between two tessellations of
  the same bolt read as a different placement, and the warning named a part
  it should not have. The nut in that file really is placed two ways and is
  still named. ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md),
  amendment 18)
- **The summary export says when every weight was typed by hand.** With
  every counted kind overridden, it now reads *entered by hand — plate 12 lb
  — the density … was not used*, instead of naming the density first.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md),
  amendment 18)
- **The bound beside a weight-limited count says so.** *2 fit (upper bound 2
  under the cap)* on the panel and in the summary export, where the bound
  used to read like the carton's capacity one line above the sentence giving
  the real one. ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md),
  amendment of 2026-09-09)
- **A count with no part chosen says what it counted.** The result reads
  *1 fit — the whole file as one unit* on the panel, in both exports and to an
  assistant, instead of a bare number.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md), amendment 14b)
- **Fill says whose boxes it counts.** In a max-quantity run with no unit
  part chosen, the fill is the whole file's box replicated, air between the
  parts included, and read higher than the same parts in fit-check under the
  same label. The panel tooltip, both exports and the assistant's reply now
  say *part bounding boxes*, *plate bounding boxes*, or *whole-file bounding
  box, the air between them counted*.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md), amendment 14)
- **A saved estimate says when a weight was typed by hand.** The one-line
  receipt ends with *plate weighed by hand* (or *2 kinds weighed by hand*), so
  two rows that differ only because of a hand-typed weight no longer read the
  same. ([ADR-0035](doc/adr/0035-customers-are-a-label-on-presets-and-receipts.md), 11th dogfood)
- **House rows are labelled once a customer exists.** Receipts and presets
  say *House* or the customer's name, so a list under one customer tells
  everyone's rows from theirs. With no customers, nothing is labelled.
  ([ADR-0035](doc/adr/0035-customers-are-a-label-on-presets-and-receipts.md))
- **The saved-estimates list shows the loaded model's receipts.** Load a
  part and the list is that part's saved estimates, found by the file's
  content, not its name; a **This model / All** switch widens it to every
  saved estimate.
  Nothing is hidden from All and nothing is deleted by a load. With no model
  loaded the list is the full one and says so.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))
- **A re-exported part can keep its history.** Load a file the app has not
  seen before, whose name matches a part with saved estimates, and one line
  offers to treat it as a new version: **Link** brings the earlier receipts
  into this model's list, labelled *earlier version*; **Keep separate** leaves
  them apart. Nothing links by itself, every receipt keeps the version it was
  saved against, and restoring an earlier version's inputs recomputes against
  the geometry loaded now. The database schema moves to version 2 to record the
  link; existing rows are untouched.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))
- **An assistant can ask for this part's saved estimates.** `list_saved_estimates`
  takes `scope` — the loaded document by default, or everything — and says
  which it answered with; `get_app_state` reports how many receipts the loaded
  document holds. Additive; nothing an assistant already does changes.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md), amendment 8)
- **Presets are a picker beside the carton fields.** Choose one from a
  dropdown under the Carton heading and it fills the fields; the dropdown
  clears itself the moment you change a field, so it never claims a preset
  that is no longer what is entered. Save and Delete sit with it. The standalone
  list of presets is gone.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))
- **AI assistants moved to the header.** The connect surface, which sat at
  the bottom of the scrolling column beneath every preset and receipt, is now
  a button beside the theme picker that opens it in a dialog; Escape, Close,
  or a click outside dismisses it. Nothing about
  connecting changes; it is just where you find it. The app no longer checks
  for installed assistants at launch, only when the dialog opens.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))
- **Saved estimates fold away.** The section is collapsed by default with its
  count in the heading, *3 for this model*, and opens with a click; the app
  remembers whether you left it open. Every saved estimate is listed, not the
  first twelve. The presets and AI assistants below it
  are no longer pushed off-screen by a long list.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))
- **Saved estimates can be deleted.** Each row has a Delete beside *Restore
  inputs*, like presets have had; the row fades out so you see it go. Not
  undoable, and not available to an AI assistant: the person at the keyboard
  can discard a receipt, an assistant cannot discard one for them.
  ([ADR-0034](doc/adr/0034-the-loaded-model-owns-its-state.md))

### Fixed

- **Saved estimates list in the order they were saved, whatever the clock
  says.** The list ordered by the timestamp on each row, and a machine whose
  clock read ahead for one save put the newest receipt third. It now orders by
  insertion; the time shown on a row is unchanged.
  ([ADR-0007](doc/adr/0007-storage-better-sqlite3.md))

- **Three fields an assistant reads now say whether they describe one part or
  all of them.** When a file contains eight copies of a nut, the app reported
  the triangle count for all eight beside the volume of one, with nothing saying
  which was which — an assistant that divided would have been eight times wrong
  about the weight. They are now `trianglesTotal`, `sizePerInstance` and
  `volumePerInstance`. Breaking change to that surface; nothing in the app
  window changes.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An assistant can now tell whether a count is provably the best, or just the
  best one found.** The reply used to carry a single "heuristic" flag that was
  always on, sitting beside a sentence that sometimes claimed no arrangement
  could beat the answer — two assistants read that pair as the app contradicting
  itself. It now says both things separately: the search is always a heuristic,
  and *this* answer is either proven optimal or not. Breaking change to that
  surface; an assistant reads the descriptions fresh each session.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **The app now tells assistants that your inputs are remembered between
  sessions.** They always were — the carton, clearances and cap you set are
  still there next time — but nothing said so, and five assistant sessions in a
  row started work on numbers a previous session had typed. Saving a preset or
  an estimate already announced itself; this one didn't.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **Two fields an AI assistant reads have been renamed, which is a breaking
  change to that surface.** `weight.source` is now `weight.mode` — it says which
  way the app is set to get a base weight, and never meant "where this answer's
  weight came from", which is what four separate assistants read it as. And
  `inspect_model` no longer reports a weight unit, because it reports geometry
  and weighs nothing. Nothing in the app's own window changes, and no saved
  preset or estimate is affected. An assistant reads the tool descriptions fresh
  each session, so this needs nothing from you.
  ([ADR-0020](doc/adr/0020-version-1-0-0-and-what-it-promises.md))

### Fixed

- **The warning about parts sitting at different angles now appears everywhere,
  not just to assistants.** When a file places several copies of a part at
  different orientations, their measured boxes differ and the count depends on
  how the file was saved. The app said so when an assistant asked, but the
  results panel and both exports stayed silent — so a copied summary or CSV
  carried the number without the caveat. All four now say the same sentence.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **"Fill" now says what it is a percentage OF at both ends.** It read
  "bounding boxes", which describes what is being counted but not what it is
  divided by — so "34% full" looked like "66% still usable" when clearances
  mean less than that is reachable. It now reads "part bounding boxes ÷ carton
  interior" and notes that clearances are not deducted.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **A saved estimate's one-line summary now says what actually limited it.**
  Rows limited by the carton showed no limit at all, and rows where the carton
  and the weight cap landed on the same number said only "weight-limited" —
  which invites the wrong conclusion, that a lighter part would fit more. Those
  now read "space-limited" and "both limits". A saved estimate that fit
  everything no longer claims a limit stopped it.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))

- **An assistant is now told when a file's parts sit at different angles.** The
  app already reported that some parts arrive rotated differently — so their
  measured boxes differ — when asked to inspect a model, but not when asked for
  an estimate, which is the only question many assistants ask. The estimate now
  carries the same qualification, for the parts it actually counted.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **"None fit" no longer blames the carton when the weight cap is what stopped
  it.** A zero count always read "None fit in this carton." — even when the
  carton had room for three and a weight limit was the only thing in the way.
  In an exported quote that sentence sat two lines above a correct one saying
  the carton would take three. A zero now names its limit the way every other
  count does, and keeps the carton wording only when the carton really is what
  stopped it.
  ([ADR-0003](doc/adr/0003-packing-modes-and-tiers.md))

- **The "space-only count" is always reported now.** The number that separates
  a roomy carton from a full one went missing in one case — a weight-limited
  count the app had already proven full — where it was the field a reader
  reached for to double-check. It was derivable all along, so it is now stated
  rather than skipped, and it appears on every CSV export.
  ([ADR-0033](doc/adr/0033-prove-the-carton-has-room.md))

- **Exports now say what "Fill" is a percentage of.** The figure counts the
  space taken by each part's bounding box, which is not the same as the volume
  of the part itself — the app said so on screen and on the AI surface, but the
  summary and the CSV printed a bare percentage. Both now name the basis, in
  the artifact most likely to end up in a customer's hands.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **"How many could possibly fit" is a much tighter number now — and on the
  reference plate it is exact.** The ceiling beside a max-quantity count could
  sit well above anything that actually fits, because it considered part
  orientations the carton cannot accept at all: a 7 in plate was measured as
  though it might stand on edge in a 3.5 in space. Orientations that cannot go
  in the box no longer count toward the ceiling. Where the ceiling now meets
  the count, the app says the carton is provably full instead of hedging.
  ([ADR-0022](doc/adr/0022-extreme-point-placement-shelf-stays-as-incumbent.md))

- **Ctrl+Z now puts back which part you were counting.** Undo walked back the
  carton and the weights but left the part selection where it was — so undoing
  a restored estimate could land you on numbers for a question you had not
  asked. Choosing a part in the picker is now an undo step like any other
  input, and stepping back past a newly opened file no longer restores a part
  that file does not contain.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))

- **An assistant is no longer told to quote the wrong capacity number.** The
  packing tools report three "how many could fit" numbers, and the guidance
  pointed at the one that is only a ceiling — routinely higher than anything
  that actually fits — as the way to judge a carton. It now points at the
  count the app can actually place, and says plainly that the ceiling proves a
  full carton only when it equals the count.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **A carton typed as 6 in comes back as 6 in.** Dimensions echoed to an
  assistant could return as 5.999999999999999 — the exact round-trip of a
  number with no exact binary form. No answer ever moved, but it made a reader
  stop and check whether the app had understood the number it was given.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **The measurements CSV says which limit its upper bound folded in.** The
  bound has the weight cap inside it, so the same carton at a higher cap wrote
  a different number into that row with nothing to say why. The file now
  carries the carton's own bound and the count that fits on space alone beside
  it, so a quote built from the CSV can tell a full carton from a capped one.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **Loading a model now tells an assistant what it threw away.** Opening a new
  file clears the unit part and any per-kind weights you typed — kind names
  belong to the file that was open — and the app said so only in passing. The
  reply now names both, so an assistant reports "your plate weight went with
  the old file" instead of quietly counting something else.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **Applying a preset warns about the weights it leaves in place.** A preset
  carries the carton, not the file's per-kind weights, so applying one can
  land a saved carton next to weights from a different session. The warning
  existed on saving; it is now on applying too, where you meet it.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An assistant can now say how many fit on space alone, whatever the weight
  cap.** Ask how many fit under a generous cap and the answer used to include
  "not asked" where the space-only count belongs — so the reply said *less*
  about the carton in the case where the carton was the only limit. It now
  states that count either way, which is what it always was: when the cap
  isn't what stopped you, the number in front of you is already the
  carton's own. On-screen wording is unchanged.
  ([ADR-0033](doc/adr/0033-prove-the-carton-has-room.md))

- **ChatGPT (Codex) now actually gets Carton Fit's tools.** Connecting worked
  and the server showed up in ChatGPT's list, but no tools appeared: ChatGPT
  starts a connected app with only the settings its own entry names, and ours
  named one. It now carries what the app needs to start, so the tools arrive.
  If ChatGPT already lists Carton Fit, the panel will show it as pointing at an
  older setup — press **Reconnect** once and restart ChatGPT.
  On Linux that now includes the X display's authorisation file, without which
  the app could not open its window and the tools never arrived.
  ([ADR-0030](doc/adr/0030-client-agnostic-connect-surface.md))

- **A count no longer argues with itself.** When the app could prove nothing
  more fits — the count has reached its upper bound — it still added "a mixed
  arrangement may fit more", sending you looking for a unit the same answer had
  ruled out. It now says the arrangement cannot be beaten under those limits,
  and keeps the hedge only when the bound genuinely leaves room. Same wording on
  screen, in both exports, and in an assistant's reply.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **The measurements CSV carries the qualification the summary always did.**
  An estimate that reads "At least 3 fit — heuristic" on screen left the app as
  a bare `3` in the CSV, which is the file most likely to end up pasted into a
  quote. It now carries a Result note saying exactly what the screen says.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **A saved estimate now remembers which part it counted.** Saving "3 plates
  fit" and restoring it later recomputed against whatever part was selected at
  the time — 3 could come back as 1, or 1 as 3 — with nothing saying why.
  Receipts now carry the unit part and restore it, and the saved-estimates list
  names it ("3 fit · of plate · …") so rows that read alike can be told apart.
  Estimates saved before this update restore as whole-file counts, which is
  what they were actually saved as.
  ([ADR-0016](doc/adr/0016-explicit-save-history-and-input-undo.md))

- **The measurements CSV shows the volume a weight was computed from.** The
  "Box volume" column is the bounding box packing uses; the weight comes from
  the part's enclosed volume, which can differ by a few percent. The row now
  carries both, so a unit weight can be checked from the row itself.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **The packed view no longer shows an empty carton for a whole-assembly count.**
  Ask how many copies of the *entire file* fit — max quantity with no unit
  part chosen — and the count was right while the 3D view drew the carton and
  nothing in it. It now shows the assembly where it was placed.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **Exports say whether a limit actually bound, and why.** The summary and the
  CSV wrote "Limited by: weight" flat — including on a comfortable fit where
  nothing bound, and beside answers the app itself hedged. The summary now says
  "Closest limit" when nothing bound and carries the same sentence the screen
  shows; the CSV keeps its `Limited by` row and adds `Limit bound` and
  `Limit note`.
  ([ADR-0017](doc/adr/0017-export-is-presentation-of-the-live-estimate.md))

- **An assistant is told where a weight came from, not just which mode was set.**
  Price one part kind by hand and ask how many fit, and the answer said the
  weight came from the material density — true of the setting, false of the
  number it counted. It now names what actually produced the grams behind the
  answer.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An AI assistant is no longer told the carton has room when it doesn't.**
  When the weight cap limited a count, the answer sent to the assistant added
  "not the carton — there is room left" — a claim nothing had checked, and
  wrong whenever the parts filled the box at the same number. The reply now
  says what actually stopped the pack, says "both limits land here" when the
  carton is provably full too, and stays quiet about what it cannot show. Your
  counts, weights and utilization are unchanged — this was only what the app
  *said* about them.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

### Added

- **When the weight cap limits a count, the app now says whether the carton
  would have held more — by trying.** It packs a second time with the cap
  lifted: if more fit, it tells you how many the carton itself would take; if
  the count does not move, it says the carton stops it too, labelled as what
  the search found rather than a proof. Before this, a weight-limited answer
  said only that the question was not established — while the same app, asked
  with a higher cap, would answer it.
  ([ADR-0033](doc/adr/0033-prove-the-carton-has-room.md))

- **Carton Fit can now answer an AI assistant's questions directly.** The app
  hosts an MCP server — the protocol Claude Desktop and other Claude clients
  speak — with two tools so far: `inspect_model` (a CAD file's geometry, per
  part kind, with open-mesh warnings) and `estimate` (the same packing answer
  the app computes, with the same qualifications: binding constraint, upper
  bound, warnings). Every value crosses the wire with its unit named, both
  directions. Two ways to run it: launch the app with `--mcp-server`, or point
  a client at the bundled headless entry
  (`ELECTRON_RUN_AS_NODE=1 <app binary> resources/app.asar/out/main/mcp.js`) —
  or just press **Connect to Claude** in the app, below.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An AI assistant can drive the running app — and you can watch it work.**
  With the app launched in server mode, six more tools let a Claude
  conversation load a model into your window (`load_model`), change the
  carton, clearances, weight cap, mode or tier (`set_inputs` — partial edits,
  exactly like typing into the panel), weigh a part kind by hand
  (`set_part_weight`), read the current answer with all its caveats
  (`get_estimate`, `get_app_state`), and *see* the packed carton as an image
  (`capture_view`). Every change recomputes through the same auto-run your own
  edits use, replies wait until the fresh estimate exists (never a stale
  number), and each AI edit is one Ctrl+Z step — undo treats Claude's changes
  like anyone else's.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An AI assistant can reach your saved presets, receipts and exports.** Seven
  more tools let a Claude conversation list and apply your saved presets, save
  the current inputs as a new one, list and restore your saved estimates, keep
  the estimate on screen as a receipt, and hand back the CSV or the summary
  export as text — the same bytes the export buttons write, warnings included,
  with nothing written to disk unless you save it yourself. Applying a preset or
  restoring an estimate is one Ctrl+Z step, exactly like clicking it. There is
  deliberately **no way for an assistant to delete** a preset or an estimate:
  everything else it can do here is undoable, and that is not.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **In server mode the window waits until it is needed.** Claude Desktop starts
  its servers when *it* starts, so a Carton Fit started for an assistant stays
  out of sight until the first tool call actually drives it — then it appears,
  so you can watch. Closing that window no longer quits the app while an
  assistant is still connected; the next tool call opens a fresh one. And an
  invisible Carton Fit nobody is talking to quits itself rather than linger. A
  Carton Fit launched normally is unchanged: it shows its window and quits when
  you close it.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **One Carton Fit per profile, and the second launch finds the first.** Open
  the app while a hidden assistant-started one is running and you get that
  instance's window, shown and focused — not a second app quietly disputing
  your saved data with the first. Ask Claude about the app you already have
  open, and it connects to exactly that window: the part you loaded is the part
  it sees.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **Connect to Claude — one button, no JSON.** A new *Claude* section at the
  bottom of the inputs panel sets Carton Fit up in Claude Desktop for you: it
  adds this copy of the app to Claude Desktop's configuration, and tells you to
  restart Claude Desktop to finish. Anything else already in that
  configuration — other servers, your own settings — is left exactly as it was,
  and if the file cannot be read the app refuses to touch it and says so rather
  than starting it over. Both Windows flavours of Claude Desktop are found —
  the Microsoft Store build keeps its configuration somewhere else entirely,
  and looking in only one place made an installed Claude Desktop look absent. If the app later moves, the button offers **Reconnect**
  and points Claude at the new location; if Claude Desktop isn't installed, the
  section says so instead of offering a button that could not work.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

### Changed

- **"Closest limit", not "Limited by", when everything fits.** On a fit where
  every part was placed, nothing actually stopped the packing — the constraint
  shown is the one with the least room to spare. The results panel now says
  so, and the estimate an assistant receives carries a `bound` flag plus a
  sentence that reads *"Nothing bound — all 18 parts placed at 38% of the
  weight cap and 26% of the carton"* instead of claiming the weight cap
  stopped it. Found by Claude on its first session driving the app.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

- **An assistant can now tell you exactly which build answered.** A Carton Fit
  that is not a released build reports its version with the commit appended —
  `1.2.0+4f9f2f8` — the same way `/deploy` names an installer, so a number
  quoted out of a chat cannot be mistaken for the release whose number it is
  still carrying. Released builds report the plain number.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md),
  [ADR-0027](doc/adr/0027-staged-builds-name-their-sha.md))

- **A smaller install: 7.5 MB of never-used code no longer ships.** The MCP
  SDK's dependency tree included a full HTTP server stack this app never
  opens; the build now bundles only what the stdio server actually reaches.
  Every third-party licence notice still ships — the texts for bundled
  packages moved into `THIRD-PARTY-NOTICES.md` itself, and a new automated
  check fails the build's test suite if a future upgrade bundles a package
  whose notice is missing.
  ([ADR-0029](doc/adr/0029-expose-the-packing-engine-to-ai-clients.md))

## [1.2.0] — 2026-08-27

### Added

- **The control panel resizes.** Drag its right edge to give the inputs more
  room or the 3D view more room; double-click that edge to put it back where it
  started. `<` and `>` step it 40px at a time when you are not typing in a
  field. The width is remembered between launches — it is not part of a preset
  or a saved estimate, so loading either one never moves it — and it stays
  between 280px and half the window, so a width chosen on a big monitor cannot
  squeeze the 3D view to nothing on a small one.
  ([ADR-0026](doc/adr/0026-resizable-control-panel.md))

- **The app has a light theme, and a System · Light · Dark control in the
  header.** It starts on **System**, so it follows whatever your OS is set to
  and changes with it — no restart, and no white flash on launch, because the
  window frame is painted in the right colour before the page loads. Your
  choice is remembered with the window's size and position, not with your
  carton settings, so loading a preset or restoring a saved estimate never
  changes how the app looks. **The packed-view PNG export follows the theme**:
  export from the light theme and the image has a white background, which is
  usually what you want in a quote.
  ([ADR-0025](doc/adr/0025-theme-light-dark-system.md))

### Changed

- **Every weight field now picks its own unit — g, kg, or lb.** The single
  `in / lb` toggle now switches lengths only, and each weight input (the max
  package weight, the per-part weight, and the part-weights table) carries its
  own unit dropdown, so you can measure the carton in inches while weighing
  parts in grams. Switching a unit re-displays the same stored value — 35 lb
  becomes 15875.7 g, never 35 g — and your current display is preserved on
  upgrade. Exports follow suit: per-part columns use the per-part unit, and the
  packed-weight lines use the cap's unit.
  ([ADR-0024](doc/adr/0024-weight-units-decoupled-from-the-length-system.md))

- **Number fields no longer show spinner arrows, and clicking one selects the
  whole value.** Type or paste the number straight over what's there — no
  clearing it first; the keyboard arrow keys still step the value if you want
  them.
  ([ADR-0024](doc/adr/0024-weight-units-decoupled-from-the-length-system.md))

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

[Unreleased]: https://github.com/LoganBresnahan/Carton-Fit/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v1.2.0
[1.1.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v1.1.0
[1.0.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v1.0.0
[0.1.0]: https://github.com/LoganBresnahan/Carton-Fit/releases/tag/v0.1.0
