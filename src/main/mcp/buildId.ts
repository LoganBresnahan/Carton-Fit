// WHICH BUILD IS ANSWERING (ADR-0029, slice `one-version-handshake`).
//
// An MCP client is told a server's version once, in the handshake, and it is
// the only identity Carton Fit ever gives it. ADR-0020 makes that number a
// promise about behaviour — so between releases, when `package.json` still
// carries the LAST release's number, the handshake would otherwise let a
// dogfooding build introduce itself as the release it is not. That is exactly
// the confusion ADR-0027 was written about, arriving on a second surface: there
// it was an installer filename, here it is what Claude will quote back to
// someone asking which version answered.
//
// So the same rule applies, with the same `+sha` form: a build that IS its
// release says the release's number, and anything else appends its short sha
// (and `-dirty` when the tree was not clean).
//
// COMPOSED AT BUILD TIME, and only for this wire. ADR-0027 §4 keeps the
// internal version string clean, and `src/main/version.ts` REJECTS a build
// suffix by design — the update check reads `app.getVersion()`, compares it
// against a release tag, and its documented response to anything it cannot
// parse is silence (ADR-0021 §3). Stamping the version at its source would
// therefore trade a truthful handshake for an update check that never speaks
// again. Nothing here touches `package.json` or `app.getVersion()`; the suffix
// is a build-time constant that only the server reads.

/** Injected by electron-vite's `define` in the main build; absent under vitest
 *  and anywhere else this module is imported without that build. */
declare const __BUILD_ID__: string | undefined

/**
 * The suffix for this build — `''`, `'+4f9f2f8'` or `'+4f9f2f8-dirty'`.
 *
 * Empty when the constant was never injected, which is the honest answer for a
 * context that is not a build (a unit test, a `tsx` script): no claim beats a
 * guess, and the version then reads exactly as `package.json` says.
 */
export function buildId(): string {
  return typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''
}

/** What the build knows about itself when the id is derived. */
export interface BuildStamp {
  /** `package.json`'s version — what a release tag would have to match. */
  version: string
  /** Short commit sha, or null when git could not be consulted at all. */
  sha: string | null
  /** Whether the working tree had uncommitted changes. */
  dirty: boolean
  /** Tags pointing at the built commit. */
  tags: readonly string[]
}

/**
 * ADR-0027's rule, as a function — shared by the build (which derives the
 * constant) and by the tests that pin it.
 *
 * The four cases, in the order they are decided:
 *
 *   - **No git.** Say nothing. A build from an exported tarball has no sha to
 *     offer, and inventing one would be worse than the silence.
 *   - **Dirty tree.** Always suffixed, tag or no tag: a dirty tree at a release
 *     tag is a snapshot, not the release, because those are not the bytes the
 *     tag published (ADR-0027 §2).
 *   - **At its own release tag.** No suffix. The build *is* that release, and
 *     an unadorned number is what makes a released build indistinguishable
 *     from itself.
 *   - **Anything else.** The short sha, so the build says which commit to
 *     `git show`.
 *
 * Note the tag must match THIS build's own version — a checkout sitting on
 * `v1.2.0` whose `package.json` already says `1.3.0` is not a release of
 * either, and gets a sha.
 */
export function buildIdFrom(stamp: BuildStamp): string {
  if (stamp.sha === null) return ''
  if (stamp.dirty) return `+${stamp.sha}-dirty`
  if (stamp.tags.includes(`v${stamp.version}`)) return ''
  return `+${stamp.sha}`
}
