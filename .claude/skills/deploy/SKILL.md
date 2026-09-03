---
name: deploy
description: Put a verified Carton-Fit build in the user's hands. Ship bar first (vitest green twice + typecheck), then obtain artifacts — preferring the CI-built Windows installer for the current sha (ADR-0012), falling back to a local wine-free build — verify against the PACKAGED bytes using the golden samples, stage to dist-live/ with the previous build kept for rollback, and hand off a dogfood script so the user tests the new iteration on a real part. Run after substantive changes when the user wants to try the new build.
---

# /deploy — put a verified build in the user's hands

A desktop app has no server: "deployed" means artifacts built from a known
commit, verified by machine against the *packaged* bytes, and handed to the user
with a dogfood script — so their first real use is confident, not exploratory.
This skill is the one place that overwrites `dist-live/`.

**Preconditions (refuse to proceed if unmet):**
1. Working tree clean, or the user explicitly okayed deploying dirty state.
   Either way, record the exact sha (and dirty files) in the report.
2. Ship bar: `npm test` green **twice** and `npm run typecheck` clean
   (run them; don't trust memory — this is `/shipshape`'s tests gate).
   Use `npm test`, not `npx vitest run`: the `pretest` hook restores
   better-sqlite3's Node-ABI build, and packaging leaves it compiled for
   Electron (ADR-0013). This matters here more than anywhere, because `/deploy`
   packages and tests in the same session.

## 1. Obtain the artifacts — CI first, local build as fallback

Two paths. **Prefer path A**: it produces the real Windows installer, built and
verified on Windows, which a WSL build cannot do at all (ADR-0010).

### Path A — fetch the CI build for this exact sha (preferred)

```sh
SHA=$(git rev-parse HEAD)
RUN=$(gh run list --workflow=release.yml --commit "$SHA" --status success \
        --limit 1 --json databaseId --jq '.[0].databaseId')
```

If `$RUN` is non-empty, that run built **and verified** these bytes:
`--status success` means its Windows leg passed the full packaged e2e suite, the
ASAR-integrity fuse check, and the LGPL substitution check (ADR-0011) — on
Windows, against the artifact you are about to hand over.

```sh
gh run download "$RUN" --name windows-installer --dir /tmp/deploy-artifacts
```

No release.yml run for this sha? Trigger one and wait, rather than silently
falling back — the installer is worth the four minutes:

```sh
gh workflow run release.yml && gh run watch <new-run-id> --exit-status
```

(`workflow_dispatch` builds and verifies but never publishes; only a `v*` tag
creates the draft release.) Artifacts expire after 14 days — an old sha may need
a fresh run.

### Path B — local build (no CI run available, or offline)

```sh
npm run build                                 # electron-vite: main + preload + renderer
npx electron-builder --win zip --linux dir    # → release/: *-win.zip + linux-unpacked/
```

**This path cannot produce `Setup.exe`** (ADR-0010): NSIS builds its uninstaller
by *executing* the installer, so the `nsis` target needs wine on Linux and dies
with `spawn wine ENOENT`. wine was rejected — it fixes one step today and does
nothing for the native modules arriving with ADR-0007. So path B ships the zip
and **must say so**: no Start-menu entry, no uninstaller.

Both packages come from the same `npm run build`, so the smoke test in step 2
exercises the same bytes being shipped.

## 2. Verify the packaged bytes

**Path A — already verified, and by the better machine.** Do not re-run the
Linux suite to feel thorough: it would test a *different* artifact (the AppImage
or a local build) than the installer being handed over. Record what CI actually
ran, with the run id, and move on. If you want the provenance in the report,
`gh run view "$RUN"` lists the steps.

**Path B — smoke locally, against the packaged binary:**

```sh
npm run e2e:packaged      # PACKAGED_APP=release/linux-unpacked/... playwright test
```

Runs every spec in `e2e/` via `_electron.launch()`: `smoke.spec.ts` loads golden
parts from `samples/` through the picker path and asserts the hand-computed
count / verdict / binding constraint from `samples/goldens.ts`;
`packing-ui.spec.ts` covers auto-run, truncated layouts, the unit picker, and the
view toggle. Traces land in `test-results/`.

**Dev-mode green does not count** (ADR-0005) — packaged builds fail in
packaged-only ways: `file://` asset paths, the 7.6 MB WASM load, module workers.
A smoke failure is a deploy stopper: read the failure and its trace before
touching anything. Needs a display and software GL; WSLg supplies the display
locally and the SwiftShader flags live in `e2e/harness.ts`.

Note what path B cannot tell you: it verifies a *Linux* build. The Windows bytes
are only ever machine-verified by CI.

## 3. Stage with rollback

```sh
rm -rf dist-live.prev
[ -d dist-live ] && mv dist-live dist-live.prev      # keep exactly one previous build
mkdir dist-live

SRC=/tmp/deploy-artifacts/windows-installer/Carton-Fit-Setup-*.exe   # path A
# SRC=release/*-win.zip                                              # path B

# Name it for what it IS (ADR-0027). electron-builder names its output from
# package.json, which is bumped at RELEASE time — so between releases every
# build reuses the last release's number and can impersonate it.
#
# Key on the commit the ARTIFACT was built from, which is not always HEAD:
# path A's CI run has its own, and staging a published release while main has
# moved on is the normal case right after a release.
REF="$(git rev-parse --short HEAD)"                 # path B, or path A at HEAD
# REF="$(gh run view <id> --json headSha --jq '.headSha[0:7]')"   # path A
LABEL="$REF"
[ -n "$(git status --porcelain)" ] && LABEL="$REF-dirty"

NAME="$(basename $SRC)"
VERSION="$(git show "$REF:package.json" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")"
# A release keeps its exact name — but only from a clean tree: dirty bytes at a
# tag are not that release. Everything else is a snapshot.
if [ "$LABEL" = "$REF" ] && git tag --points-at "$REF" | grep -qx "v$VERSION"; then
  echo "release build → $NAME"
else
  NAME="${NAME%.*}+$LABEL.${NAME##*.}"
  echo "snapshot → $NAME"
fi

cp $SRC "dist-live/$NAME"
echo "$REF" > dist-live/BUILD_SHA
```

At a tag matching that build's `package.json`, the staged file keeps the
release's exact name — it *is* that artifact. Anywhere else it becomes
`Carton-Fit-Setup-1.1.0+4f9f2f8.exe`, and the report calls it a **snapshot**
rather than a release.

This is not fussiness: `dist-live/BUILD_SHA` already recorded the sha and was
not enough, because the installer gets copied out of WSL to run it and the
sidecar does not travel with it. A build staged as `Carton-Fit-Setup-1.1.0.exe`
from post-1.1.0 code was installed as "1.1.0", reinstalled later to compare
against the real thing, and delivered the newer features both times — nothing
malfunctioned, the file just answered "which build is this?" wrongly. Whatever
identifies a build has to be on the build.

Stage **one** runnable artifact, not everything available — `dist-live/` is what
the user runs, not an archive. Then print the Windows-reachable path:
`\\wsl.localhost\<distro>\home\oof\Carton-Fit\dist-live\<file>`
(get `<distro>` from `$WSL_DISTRO_NAME`). Copy it out of WSL before running —
launching from the `\\wsl.localhost` share works but is slow.

The Windows install/launch is the user's step — WSL cannot verify it; say so
rather than implying it. State plainly rather than bury:

- the app is **unsigned**, so SmartScreen warns on first run (More info → Run
  anyway). True on both paths; code signing isn't set up (ADR-0010).
- **path B only:** a zip has no Start-menu entry and no uninstaller — delete the
  folder to remove it. Path A's installer has both.

## 4. Dogfood handoff

The machine check proved the build on golden inputs; dogfooding proves it on real
ones. Tell the user concretely what to exercise on a **real part from their
current work** — the surfaces this iteration touched, plus the standing trio:
does the count survive a sanity check, does the packed view match the numbers, is
the binding constraint (geometry vs weight) attributed right? Any surprise gets
written down immediately as a carry-in on the relevant `doc/roadmap.md` item —
dogfood findings evaporate if they only live in chat.

**For the MCP surface, the handoff is a document, not a paragraph.** Point the
user at `doc/dogfood/mcp-session.md` — the paste-able brief `/dogfood` maintains
(ADR-0032) — and name the build's `+<sha>` so the report that comes back can be
matched to it. Do not summarise the brief's stations into the handoff, and do
not mention the expected numbers: the brief withholds them deliberately, and a
handoff that leaks them turns the pass into a confirmation exercise.

### When the build touched the connect panel (ADR-0029, ADR-0030)

The MCP clients are the one surface where **no machine check substitutes for
this pass**. Claude Desktop's config path was wrong for a Store install and
every test agreed with the assumption; Codex is verified by *nothing* on CI —
no runner has it, so `e2e/codex-connect.spec.ts` drives a fake built from a
contract we wrote down, and `e2e/codex-real-cli.spec.ts` skips everywhere but a
machine with the real thing. Ask for:

- **Claude Desktop** — click Connect, restart it, confirm the Carton Fit tools
  are listed and one of them answers about the part that is open.
- **ChatGPT (Codex)** — same, and the restart is of the *desktop app*, not the
  CLI: `codex mcp list` will already show the entry while ChatGPT still does
  not, which is the confusing case the panel's restart line exists for.
- **What `codex mcp add` created in the real home.** In a throwaway `CODEX_HOME`
  it declined to write PATH aliases and helper binaries; in `~/.codex` it
  presumably writes them. It is a write nobody asked for, so record what
  appeared (ADR-0030 open detail 2).
- **Whether the newest `codex.exe` and the desktop app agree.** Discovery picks
  the newest directory under `%LOCALAPPDATA%\OpenAI\Codex\bin` by mtime, which
  is a heuristic. If they ever disagree about `config.toml`'s location, `codex
  mcp get` reports the entry exists while ChatGPT never sees it — the one
  failure this design cannot detect from inside (ADR-0030 open detail 3).
- **Anything the real CLI normalises.** If it rewrites our args or env, the
  panel will read `outdated` forever however many times Connect is pressed.
  That is the ADR's budgeted fix-up, and it looks like a button that never
  finishes the job.

## 5. Report

```
DEPLOYED — Carton-Fit @ <sha> → dist-live/
  ship bar     vitest <n>/<n> ×2 · typecheck clean
  artifacts    <file, MB> — <release | snapshot @ <sha>> — <CI run <id>,
               windows-latest | local build, wine-free>
  verified     <n>/<n> e2e + ASAR fuse + LGPL substitution on Windows (CI run <id>)
               | <n>/<n> e2e vs the packaged LINUX build (local)
  run          \\wsl.localhost\<distro>\...\dist-live\<file>
  caveats      unsigned (SmartScreen) <· zip: no Start-menu entry or uninstaller>
  rollback     dist-live.prev/ holds the previous build (BUILD_SHA <prev sha>)
  dogfood      <the 2-3 things to try on a real part this iteration>
```

Rollback is one swap: the previous build sits whole in `dist-live.prev/`, stamped
with its sha.

**A draft release is not a deploy.** A `v*` tag makes CI attach artifacts to a
*draft* GitHub release; publishing it is a separate, human act after dogfooding
(ADR-0012). `/deploy` stages to `dist-live/` and never publishes — if the user
wants the release public, that is `gh release edit <tag> --draft=false`, asked
for explicitly.
