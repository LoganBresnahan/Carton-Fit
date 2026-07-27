// Version comparison for the update check (ADR-0021 §2).
//
// Deliberately free of electron imports, the same discipline windowState.ts
// uses, so vitest can exercise it directly rather than through a launched app.
//
// No `semver` package: ADR-0011 prices a runtime dependency at an ADR plus a
// THIRD-PARTY-NOTICES entry, which is not a trade worth making to compare three
// integers. The narrowness is deliberate in the other direction too — anything
// this cannot parse means "say nothing" (ADR-0021 §3), so a strict shape here
// turns an unexpected tag into silence instead of a wrong claim.

interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/**
 * `v1.2.3` or `1.2.3` → its three parts; anything else → null.
 *
 * Prerelease and build suffixes are REJECTED rather than truncated. The
 * Releases API never returns a prerelease to begin with (ADR-0021 §1), so a tag
 * carrying one means the assumption behind this check has changed — and the
 * documented response to that is silence, not a guess about ordering.
 */
export function parseVersion(raw: string): Version | null {
  const parts = raw.trim().replace(/^v/, '').split('.')
  if (parts.length !== 3) return null

  const numbers: number[] = []
  for (const part of parts) {
    // Number() alone would accept ' 1', '1e2' and '0x10'; the pattern is what
    // makes this a digit-string test rather than a coercion.
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }

  const [major, minor, patch] = numbers as [number, number, number]
  return { major, minor, patch }
}

/**
 * True only when `candidate` is strictly newer than `current`.
 *
 * Equal versions and older ones are both "no banner", and so is either side
 * failing to parse — including `current`, which is `app.getVersion()` and so
 * should never fail, but a build that somehow reports a version we cannot read
 * has no business claiming another one is newer than it.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (next === null || now === null) return false

  if (next.major !== now.major) return next.major > now.major
  if (next.minor !== now.minor) return next.minor > now.minor
  return next.patch > now.patch
}
