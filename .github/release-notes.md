Drag a STEP or STL file in, enter your carton and constraints, and get the best
packing orientation, the part count, and a 3D view of the packed box. The
estimate follows the inputs — there is no compute button — and it always states
which constraint bound the answer, geometry or weight.

**New in 1.1.0 — the packing itself got better, and it now shows its reasoning.**
Fit check tries a second arrangement strategy alongside the original one and keeps
whichever fits more, so assemblies of mixed shapes and heights that used to come
back "couldn't find a fit" now pack: across a 240-case test sweep it improved a
third of them and made none worse. Max quantity mixes orientations for the same
reason — 1×1×2 blocks in a 3×3×3 box went from 9 to 13, which is the most that
physically fit. Two new things on screen: a "doesn't fit" now says how much usable
room was left and what the smallest leftover part needed, and a count now carries
a rigorous upper bound beside it, so you can see how much a better arrangement
could still recover. Counts only ever move up; a verdict is still a best effort,
never a proof.

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
