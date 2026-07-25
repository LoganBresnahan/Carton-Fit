Built by CI on each platform natively (ADR-0010).

**Windows** — `Packaging Estimator Setup <version>.exe` is the installer; the
`-win.zip` is the same app, unzip-and-run.
**Linux** — `.AppImage`, `chmod +x` and run.

Verified before this draft was created: unit tests, typecheck, and the full
Playwright suite against the *packaged* build on both Linux and Windows, plus
the ADR-0011 licence-compliance checks.

Known limitations:

- **The Windows build is unsigned**, so SmartScreen warns on first run
  (More info → Run anyway). Code signing is not set up yet.
- No auto-update.

Licensing: this app is MIT. It bundles LGPL-2.1 `occt-import-js`; see
`THIRD-PARTY-NOTICES.md` in the installed folder for the notices, and for how to
substitute your own build of that library.
