# ADR-0021: the update check notifies but never installs, and banners live in the header

Date: 2026-07-26
Status: Accepted
Relates to: ADR-0007 (storage is optional, so a failure must be *said*),
ADR-0011 (dependency policy), ADR-0012 (draft releases, human publish),
ADR-0020 (what 1.x promises)

## Context

1.0.0 is about to go into other people's hands, and every installer that ships
without an update mechanism creates a user who can never learn that a newer
version exists. That cost compounds: 1.1.0 can only announce itself to people
running a build that already knows how to look. Whatever the mechanism is, it
belongs in the first release people actually install — which, since 1.0.0 is
still an unpublished draft, means 1.0.0 itself.

The roadmap's placeholder said "auto-update via electron-updater". Three facts
argue against that being the right shape now:

- The installer is **unsigned** (item 10 carry-in). Auto-installing an unsigned
  binary does not remove the SmartScreen moment, it relocates it to a place
  where the user did not initiate anything — strictly worse for trust.
- electron-updater is a **new runtime dependency**, which ADR-0011 prices at an
  ADR plus a notices entry, and it drags in a server-side contract
  (`latest.yml`, staged rollouts, differential updates) sized for a product
  with a release cadence this project does not have.
- Publishing is a **human act** (ADR-0012: CI drafts, a person publishes after
  dogfooding). Installing should stay one too. The user is mid-quote with the
  app open; nothing about that moment wants a surprise restart.

What the moment actually needs is much smaller: the app should *know* when it
is out of date, say so quietly, and hand the user the download link.

That raised a second question the app had never had to answer: **where does a
banner live?** There was exactly one before this — the storage banner from
roadmap item 9 — and it was pinned above the scrolling inputs, inside the
360px control column. Adding a second banner to that same slot exposed what
was already wrong with it. The column is the narrowest region in the window,
so a sentence-length message wraps to three lines; every line it takes is
taken from the drop zone directly beneath it; and the thing being reported —
storage is broken — is not a fact about the inputs column at all. It degrades
the presets panel, the saved estimates panel, and the *Save estimate* button
in the results footer.

Meanwhile the header holds a title and roughly 900px of nothing.

## Decision

### The update check

On every app open, the **main process** checks GitHub for the latest published
release and, if it is newer, tells the renderer to show a banner. Nothing
downloads, nothing installs, nothing blocks.

1. **The source of truth is the Releases API**:
   `GET https://api.github.com/repos/LoganBresnahan/Carton-Fit/releases/latest`.
   This endpoint only returns **published, non-draft, non-prerelease** releases
   — so the check inherits ADR-0012's gate for free: a draft that dogfooding
   rejects is invisible to every installed copy.
2. **The check runs in main, after the window shows.** It uses Electron's
   `net.fetch` with a short timeout — no new dependency — and compares the
   release `tag_name` against `app.getVersion()` with a plain numeric
   major.minor.patch compare (three integers; no `semver` package for a
   three-line comparison).
3. **Every failure is silence.** Offline, DNS, a 403 from rate-limiting, a
   changed response shape, a tag that does not parse — all of them mean "say
   nothing", not "say something scary". A packing estimator must never nag
   about the network. The failure path is a contract, so it gets its own e2e.
4. **The banner is the whole UI.** One line — "Version 1.1.0 is available ·
   Download" — where Download opens the release page in the system browser
   (`shell.openExternal`, brokered through preload like every privileged call).

### The header is the app-scope status area

5. **Both banners move to the header, to the right of the title**, and the
   storage banner leaves the control column. The header is the only region
   that is app-scope, always visible, and horizontally roomy. Item 9's
   requirement — a storage failure must never be scrollable out of sight —
   stops being an arrangement of flex siblings that a future refactor could
   undo, and becomes structural: the header cannot scroll. The existing e2e
   already asserts this as a *relationship* (`toBeInViewport()` at both scroll
   extremes) rather than a position, so it survives the move unchanged and
   proves more than it did before.
6. **The header's height must not depend on its contents.** It gets an
   explicit height sized for the chip, because the update banner arrives
   **asynchronously** — a second or two after launch, whenever the network
   answers. A header that grows when it appears would shift the entire window
   downward under a cursor that may already be moving toward a control. Zero
   layout cost at any moment is the requirement; a fixed height is how it is
   met.
7. **Messages truncate rather than wrap**, with the full text in a `title`
   tooltip (`min-width: 0` plus ellipsis). Wrapping would change the header's
   height, which item 6 forbids. This is an acceptable trade only because the
   amber tint and the uppercase `STORAGE` label survive truncation: at any
   window width the user still sees that something is wrong, and at normal
   width the whole sentence fits. The chip keeps its colour treatment rather
   than flattening into header text — against an empty header that reads as
   conspicuous, which is what item 9 requires.

   **Amended 2026-07-26, during implementation.** "Messages truncate" turns out
   to be true only of the STORAGE message. Letting both chips shrink
   proportionally — the obvious reading, and what was built first — was wrong
   the moment it was looked at: at an ordinary 1280px window "Version 1.4.0 is
   available" collapsed to "Versi…" while the storage sentence beside it kept
   every character, and at 720px the update chip was clipped mid-word with its
   dismiss button off-screen and unclickable. The justification above does not
   transfer between the two messages: storage is prose whose signal survives in
   the tint and the label, whereas **the version number is the update chip's
   entire actionable content**, so a truncated one says nothing that can be
   acted on. The news chip therefore does not shrink and the storage chip
   absorbs all of the truncation. Decision 8 is unaffected — storage is still
   leftmost and still the first thing seen; only which chip loses characters
   changed.
8. **When both are present, storage comes first.** A malfunction outranks
   news.

### Dismissal

9. **Both banners are dismissable, and dismissal applies to the occurrence,
   not to the banner.** The update banner returns on the next launch;
   deliberately **no persisted dismissal**, because ADR-0020 made the
   localStorage settings key part of the versioned surface and re-showing a
   true statement once per launch does not justify growing that surface.
10. **A new storage failure re-arms the storage banner**, and the dismissal
    state is keyed on an **occurrence counter, not the message text**. This is
    the subtle half. Item 9's finding was that storage failures had reached
    only `console.warn`, so "every estimate is recorded" could quietly stop
    being true — silence read as success. A plain dismiss button recreates that
    bug one click later. Worse, two consecutive failed saves usually produce
    the *identical* string, so keying dismissal on the message would swallow
    the second one — precisely the case where the user has retried and most
    needs to be told. `setStorageError` bumps a sequence; the banner shows
    whenever the sequence has moved past what was dismissed.

## Consequences

- The app now contacts `api.github.com` once per launch, which discloses the
  user's IP and the fact that they run Carton Fit. That is a user-visible
  behaviour change and goes in the CHANGELOG. There is no telemetry payload —
  it is an unauthenticated GET a browser could make.
- Unauthenticated GitHub API calls are rate-limited to 60/hour per IP. Once
  per launch cannot approach that; anything that starts polling would, which
  is a reason this stays launch-only.
- The banner can only ever point at the **latest** release. Someone three
  versions behind gets one banner naming the newest version, which is correct
  behaviour, not a gap.
- The drop zone gets its vertical space back permanently: banners now cost the
  control column nothing, whether one, both, or neither is showing.
- A storage failure the user has dismissed is invisible until the next one
  occurs. That is the intended trade — but it means the *report* is now the
  only signal, so the re-arm in decision 10 is load-bearing and gets an e2e
  that dismisses, triggers a second failure, and requires the banner back.
  Deleting the re-arm must fail that spec and nothing else.
- The roadmap's "auto-update via electron-updater" item is **superseded** by
  this ADR, not deferred by it. Silent install becomes worth revisiting only
  behind a signed installer — see revisit triggers.
- Tests own the check's URL: main honors an `UPDATE_CHECK_URL` override from
  the environment so the e2e can point at a local fixture — one spec proves the
  banner appears for a newer version, one proves an unreachable URL produces
  nothing. The version compare is a pure function under vitest.

## Alternatives considered

- **electron-updater (full auto-update).** Rejected above: unsigned installer
  makes it trust-negative, new runtime dependency, server-side release
  contract out of proportion to the cadence, and it converts installing from
  a human act into a background one.
- **Checking from the renderer.** Rejected: it would need a CSP hole for
  `api.github.com` and puts a network egress in the sandboxed process. Main
  already owns every other privileged boundary (storage, export, dialogs).
- **A "check for updates" menu item instead of an automatic check.** Rejected
  as the primary mechanism: the person who most needs the information is the
  one who does not know to ask. Fine as a later addition.
- **Leaving the banners in the control column.** Rejected: it is the narrowest
  region in the window, it forces wrapping, every wrapped line is taken from
  the drop zone, and it scopes an app-wide condition to the inputs.
- **Keeping the storage banner undismissable.** Tempting, since it reports a
  live malfunction and dismissing hides something still true. Rejected because
  the re-arm rule preserves the invariant that actually matters — no failure
  goes unreported — while letting a user who already knows get their space
  back. An undismissable banner in a narrow column is also how users learn to
  stop reading banners.
- **Persisting "don't show again for this version".** Rejected for now — it
  grows the ADR-0020 versioned surface to suppress a banner that is true.
  Becomes worth it if launch-frequency users report nagging.

## Revisit triggers

- A code-signing certificate exists (item 10 carry-in resolved) → silent
  download-and-install-on-quit becomes trustworthy enough to reconsider.
- The release cadence rises to the point where once-per-launch banners feel
  like nagging → add per-version dismissal.
- A third banner appears, or the header starts feeling crowded at narrow
  widths → the header becomes a status *strip* with its own layout rules
  rather than a flex row that happens to hold chips.
- GitHub Releases stops being the distribution channel → the endpoint, and
  this ADR, go with it.
