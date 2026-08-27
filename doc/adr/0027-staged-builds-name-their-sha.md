# 0027 — A staged build that is not a release names its sha

Status: Accepted (2026-08-27)

## Context

electron-builder names its output from `package.json`, and this project bumps
that number **at release time**, in the commit that tags (ADR-0020, and CI's
gate compares the two). Between releases, then, every build electron-builder
produces reuses the *previous* release's number: at sha 4f9f2f8 — theme,
resizable panel, and per-input weight units all merged — `npm run package`
still produced `Carton-Fit-Setup-1.1.0.exe`, byte-different from the v1.1.0
that shipped on 2026-07-27 and wearing its name.

`/deploy` staged exactly that file to `dist-live/`, and it did what a file
called `Carton-Fit-Setup-1.1.0.exe` invites: it was installed as "1.1.0". The
user, wanting to compare against the released build, uninstalled 1.2.0 and
reinstalled that — and got the 1.2.0 features back, because the bytes were
1.2.0's. Nothing malfunctioned; the answer to "which build is this?" was
simply wrong, and the app's own About-equivalent agreed with the wrong answer
(the internal version string comes from the same `package.json`).

`dist-live/BUILD_SHA` recorded the truth the whole time. It was not enough:
the file gets copied out of WSL to install it, and the sidecar does not travel
with it. Whatever identifies a build has to be *on* the build.

This is ADR-0020's promise viewed from the other side. That ADR says what a
version number means for released artifacts, and CI enforces it with "one
honest version per installer" — but it is silent on the artifacts that never
get a tag, which is most of what a person actually installs during
development.

## Decision

1. **`/deploy` stages the artifact under a name that says what it is.** If
   `HEAD` carries the tag matching `package.json`'s version, the build *is*
   that release and keeps the release's filename exactly. Otherwise the short
   sha is appended before the extension:
   `Carton-Fit-Setup-1.1.0+4f9f2f8.exe`.
2. **A dirty tree adds `-dirty`** (`…+4f9f2f8-dirty.exe`). Deploying dirty is
   already allowed with the user's okay and already recorded in the report;
   this puts it on the file too.
3. **`+` is the separator**, borrowed from semver's build-metadata field,
   which is precisely this: identity that does not change ordering. It is
   legal in Windows filenames.
4. **The internal version string is left alone.** Changing it would mean
   patching `package.json` before packaging, which makes the artifact
   disagree with the commit it was built from — trading a misleading name for
   a lying commit. The filename is what a person reads when choosing what to
   install; that is the surface worth fixing.
5. **`dist-live/BUILD_SHA` stays.** It is still the answer for "what is
   staged right now" without parsing a filename, and the report keeps citing
   it for the rollback build.

## Consequences

- A staged pre-release build can no longer impersonate a released one, which
  is the whole point: the two are now distinguishable in the place where the
  choice is made — the file picker.
- The filename tells you which commit to `git show`. When dogfooding turns up
  something, the build that produced it is identified without asking anyone
  what was current that evening.
- Released builds are unaffected: at a tag the name is byte-identical to the
  GitHub release asset, so what the user installs and what the release page
  offers cannot drift apart in name either.
- `/deploy`'s report gains one word per artifact — *release* or *snapshot* —
  because a rule nobody sees is a rule nobody trusts.
- The two installers already in `dist-live/` and `dist-live.prev/` predate
  this and keep their misleading names until the next `/deploy` overwrites
  them. Renaming them retroactively would produce a file whose name and
  internal version disagree in the *other* direction, which is not an
  improvement; the next deploy is the fix.

## Alternatives considered

- **Bump `package.json` to a prerelease (`1.2.0-dev.4f9f2f8`) on every
  build.** Honest names and an honest internal version — but it puts a
  synthetic version in a tracked file, so either every deploy dirties the
  tree or the artifact is built from something that is not the commit. CI's
  version gate would also need to learn about prerelease shapes.
- **Stage into a per-sha directory** (`dist-live/4f9f2f8/…`). The path
  carries the identity, but the file is what gets copied to Windows, and it
  arrives in Downloads with the path stripped off. Same failure, one step
  later.
- **Rely on `BUILD_SHA`.** It is what we had. See Context.
- **Refuse to stage untagged builds at all.** That is the opposite of what
  `/deploy` is for — dogfooding an unreleased iteration is the normal case,
  and releases are the rare one.

## Revisit triggers

- Code signing arrives: a signed build carries its identity in the signature,
  and the installer can show it before running. The filename may stop being
  the only readable label.
- The app grows a visible About box or version line in the UI. Then the
  internal version is readable at a glance and §4's trade-off is worth
  re-examining — probably still not worth patching `package.json`, but the
  reasoning changes.
- `/deploy` ever stages more than one artifact at a time (a dmg alongside the
  installer, say); the rule is per-file and should stay that way, but the
  report's one-word label needs a place per artifact.
