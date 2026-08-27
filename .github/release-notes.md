Drag a STEP or STL file in, enter your carton and constraints, and get the best
packing orientation, the part count, and a 3D view of the packed box. The
estimate follows the inputs — there is no compute button — and it always states
which constraint bound the answer, geometry or weight.

**New in 1.2.0 — the window is yours to arrange.** The app has a **light theme**
and a System · Light · Dark control in the header; it starts on System, follows
your OS, and paints the window frame in the right colour before the page loads,
so there is no white flash on launch. The **control panel resizes** — drag its
right edge, double-click to put it back, or step it with `<` and `>` — and it
stays between 280px and half the window, so a width chosen on a big monitor
cannot squeeze the 3D view to nothing on a laptop. Both are remembered between
launches, and neither travels inside a preset or a saved estimate. **Every
weight field now picks its own unit** — g, kg, or lb — so you can measure the
carton in inches while weighing parts in grams; the `in / lb` toggle now switches
lengths only, switching a unit re-displays the same weight rather than changing
it, and your current display carries over from 1.1.0 untouched. Number fields
lost their spinner arrows and select on click, so you can type straight over
what is there.

Full list of what is in this version:
[CHANGELOG.md](https://github.com/LoganBresnahan/Carton-Fit/blob/main/CHANGELOG.md).

Built by CI on each platform natively (ADR-0010).

**Windows** — `Carton-Fit-Setup-<version>.exe` is the installer; the
`-win.zip` is the same app, unzip-and-run.
**Linux** — `.AppImage`, `chmod +x` and run.

Verified before this draft was created: unit tests, typecheck, and the full
Playwright suite against the *packaged* build on both Linux and Windows, plus
the ADR-0011 licence-compliance checks.

Known limitations:

- **The Windows build is unsigned**, so SmartScreen warns on first run
  (More info → Run anyway). Code signing is not set up yet.
- **No auto-update, by design.** At start-up the app asks GitHub whether a newer
  release has been published and, if so, shows a one-line message with a link
  back to this page — but it never downloads or installs anything by itself.
  Installing an update is the same manual step as installing this one. Silent
  install is worth reconsidering once the installer is signed; until then it
  would only move the SmartScreen warning to a moment you did not initiate.
  That check is a single unauthenticated request to `api.github.com` per launch,
  the kind a browser makes. There is no telemetry payload — but it does disclose
  your IP address and that you run Carton Fit. It is off entirely if the machine
  is offline, and any failure is silent.

Licensing: this app is MIT. It bundles LGPL-2.1 `occt-import-js`; see
`THIRD-PARTY-NOTICES.md` in the installed folder for the notices, and for how to
substitute your own build of that library.
