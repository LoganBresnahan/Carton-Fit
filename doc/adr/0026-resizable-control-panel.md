# 0026 — The control panel is resizable: a drag handle, keyboard steps, no buttons

Status: Accepted (2026-08-26); built 2026-08-26 — see roadmap item 19

## Context

The left control panel is a hard `width: 360px` (`styles.css`, `.panel`). That
number has been the subject of three shipped bugs already: item 11's 24px
overhang (sections wearing the column's own class), ADR-0021's chip
truncation, and the export buttons that "a 360px column cannot hold four of".
Dogfooding now asks for the obvious thing — let the user set the width — and
asks whether that should come with header buttons and quick keys.

What the panel holds decides the answer. Its contents are already
width-relative where it matters: the drop zone is `min(480px, 90%)`, the
parts list is `width: 100%`, the segmented controls fill their row, the
export actions wrap. The viewport on the other side is sized by a
`ResizeObserver` (ADR-0008), not by CSS coupling, so it follows any width
without work. Nothing in the app *needs* 360; it was a first guess that
became load-bearing by being a literal.

Constraints inherited from earlier decisions:

- **Presets and saved estimates serialize `settings` whole** (ADR-0007,
  ADR-0016), so a width inside `settings` would be restored with a carton —
  the wrong-home problem ADR-0018 §3 and ADR-0025 §3 each solved by staying
  out of it. Any new localStorage key is a versioned surface (ADR-0020).
- **The header's height is fixed and its status area has truncation rules**
  (ADR-0021). Anything added to it competes with a storage warning.
- **Keyboard routing already has a rule** (ADR-0016 §2): a shortcut acts
  unless focus is in a real text field, where the browser owns the keys.
- **The panel-layout e2e guards by relationship** — no horizontal scroll, one
  shared left edge — precisely because the overhang bug passed every
  functional spec. A variable width is the thing most likely to resurrect it.

## Decision

1. **A drag handle on the panel's right edge is the primary control.** The
   existing 1px `border-right` grows a 6px invisible hit area with
   `cursor: col-resize`; pointer capture makes the drag survive leaving the
   handle. No visible chrome at rest — the affordance is the one every IDE
   teaches. **Double-click on the handle resets to the default (360px).**
2. **Keyboard steps: `Shift+,` (`<`) narrows and `Shift+.` (`>`) widens** by
   40px per press. Routed by ADR-0016 §2's rule, extended one notch: ignored
   whenever focus is in *any* editable element (text, number, select,
   contentEditable), not only text fields — `>` is not a digit, but a
   shortcut that fires from inside one field and not another is a rule
   nobody can learn. Installed beside the undo keyboard binding, split from
   the width logic the same way undo's is, so the routing unit-tests without
   a DOM.
3. **No header buttons.** They would spend fixed-height header space
   (ADR-0021) on a second way to do what the handle and keys already do, and
   the status chips already have first claim on that row.
4. **Clamped, in one place.** `min 280px`, `max = min(640px, 50% of the
   window)`; the stored value is re-clamped on every window resize, so a width
   saved on a wide monitor cannot pin the viewport to a sliver on a narrow one.
   The clamp is a pure function (`clampPanelWidth(requested, windowWidth)`)
   that the drag, the keys, the reset and the resize handler all call — four
   callers, one rule.
5. **The width is a CSS custom property, `--panel-width`, set on `.panel`
   from the store.** Every place that currently spells `360px` reads the
   variable instead; the only literal left is the default. That is what turns
   the three historical bugs' number from a constant into a parameter.
6. **Persisted in the renderer, in its own localStorage key
   (`carton-fit:layout`), outside `settings`.** Read synchronously at store
   init, the way `settings` is, so the *first frame* is already the right
   width — an async read would paint 360 and jump. This is deliberately NOT
   the ADR-0025 window-state route, and the difference is who needs the value
   and when: the theme went to main because main consumes it before the window
   exists (`backgroundColor`, `nativeTheme`); the panel width has no
   main-process consumer at all, and an IPC round-trip before first paint
   would be the only reason to add one. One new versioned key (ADR-0020),
   holding `{ panelWidth }` and nothing else; a missing or non-numeric value
   is the default.
7. **Not on the undo stack.** Width is layout, not an input; ADR-0016's
   snapshot covers `settings` and overrides, and this key is outside both, so
   nothing has to be excluded — it is simply not there.

## Consequences

- The panel-layout e2e's relationship assertions (no sideways scroll, shared
  left edge) are re-asserted **at the minimum and maximum widths**, not just
  the default — a narrow column is where an overhang reappears first. Plus:
  width survives a restart; the keys are ignored with focus in the preset
  name field and honored with focus on the body; double-click resets; and a
  window resized below twice the stored width re-clamps (deleting the
  resize handler fails exactly that spec).
- The viewport needs no change: its `ResizeObserver` already re-frames on any
  stage size change (ADR-0008). Worth one e2e line asserting the canvas width
  tracks the stage after a drag, since "already handles it" is a claim.
- The drop zone, parts list and import result are `min(480px, 90%)` /
  `100%` and scale; the `.results` footer wraps its actions. Expect to find
  one or two more literal widths while replacing `360px` — each is a small
  bug of the item-11 kind, fixed by the same variable.
- The harness's per-launch temp profile (item 11's isolation fix) means no
  spec inherits another's width.
- CHANGELOG: one entry — drag to resize, `<`/`>` to step, double-click to
  reset.

## Alternatives considered

- **Header buttons (narrow / widen / reset).** Rejected — see §3.
- **Width relative to the window (`clamp(320px, 25vw, 520px)`) with no
  control at all.** Zero UI and responsive, but it answers a question nobody
  asked ("why did my panel change when I un-maximized?") and still leaves
  the user unable to choose. Kept as the shape of the *max* clamp instead.
- **Collapse-to-icon-rail.** A different feature (hiding the inputs
  entirely); not requested, and the results footer is the app's answer,
  which should not be a click away.
- **Persist in the ADR-0025 window-state file via IPC.** Consistent with
  the theme's home, but the width is needed by the first renderer frame and
  by nothing in main; see §6.
- **Persist inside `settings`.** Presets would carry it — see Context.
- **`Ctrl+[` / `Ctrl+]`** as the keys. Collide with browser history / indent
  conventions users bring from elsewhere; `<` and `>` were the request and
  read as "narrower / wider" without a legend.

## Revisit triggers

- A panel redesign that changes what the column holds (tabs, a dims row, a
  collapsing drop zone) — the clamp bounds were chosen for *this* content.
- A request to hide the panel entirely; that is the collapse alternative,
  and it would want a different control than a drag handle.
- A second layout preference (viewport split, footer height): promote the
  `carton-fit:layout` key to a small validated layout slice rather than
  adding keys.
