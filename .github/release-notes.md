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
