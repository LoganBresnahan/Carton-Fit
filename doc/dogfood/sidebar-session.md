# Sidebar dogfood — the feel verdict for ADR-0034 and ADR-0035

The MCP brief (`mcp-session.md`) tests what an assistant can reach. This is the
other half: the sidebar and header, which no runner and no assistant can see.
Items 26 and 27 were placed by screenshot; this pass is what decides whether
they stay where they are. **Run it against the build in `dist-live/`**, and
check `dist-live/BUILD_SHA` against the app's version first — a stale build
tests the last session, not this one.

Bring back one line per station: **OK / MOVE / WRONG — what you saw.** MOVE
means the mechanism is right and the placement is not; say where it should go.
Numbers are not the point here; the app already agrees with itself on those.

## Station 1 — the scoped list

Load a part, save twice. Load a different part. The list should be empty for
it and read *For <file>*, with **This model** lit. Press **All**: both parts'
receipts, newest first. Press **This model**: back to none.

## Station 2 — versions

Re-export the same part from CAD under the same file name (any trivial change
moves the hash) and load it. One line should appear above the fold: *N saved
estimates exist for an earlier <file> — treat this as a new version?* Press
**Keep separate**, reload the file: it asks again. Press **Link**: the earlier
receipts appear, labelled *earlier version*. Restore one: the count is
recomputed against the geometry loaded now, not replayed.

## Station 3 — delete

Delete a receipt. It should fade before the next row moves up. Restart the app:
still gone. There is no confirm and no undo, by decision — say whether that
felt right.

## Station 4 — the fold

Leave the section closed for a while. Is *3 for this model* in the heading
enough at a glance, or do you keep opening it? If you keep opening it, the fold
is wrong, not the scope.

## Station 5 — the header

Find **AI assistants** without being told where it is. Open it, press Escape,
open it, click outside. Then **Working for**: create a customer (one field),
load a file, restart. Still that customer? Switch back to House: one pick.
Shrink the window to about 720 px wide: everything in the header should still
be reachable.

## Station 6 — the picker

Apply a preset, then change one carton field. The picker should clear itself
the moment the field changes. Say whether that read as honest or as a glitch.
Working for a customer, save a preset; switch to House. The preset should be
under *Other customers*, named, one scroll away.

## Station 7 — both lists under a customer

Working for a customer, save a receipt and a preset. Switch to House: the
receipt leaves the scoped list and the preset moves under *Other customers*.
Press **All**: the receipt is back, labelled with the customer.

## The report

```
build      <version as the app shows it>  ·  dist-live/BUILD_SHA <sha>
station 1  OK | MOVE | WRONG — <one line>
station 2  …
station 3  …
station 4  …
station 5  …
station 6  …
station 7  …
verdict    ADR-0034: accept | move <what> · ADR-0035: accept | move <what>
```
