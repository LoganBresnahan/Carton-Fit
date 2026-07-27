import { describe, expect, it } from 'vitest'
import { isNewerVersion, parseVersion } from '../src/main/version'

// The version compare behind the update banner (ADR-0021 §2).
//
// This is the one part of the check that decides something. The fetch either
// answers or it does not, and either way the answer is a banner or silence —
// but a wrong compare shows a confident, specific, wrong sentence about a
// version that does not exist, or hides one that does.

describe('parseVersion', () => {
  it('reads the three parts, with or without the tag prefix', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion(' v1.0.0\n')).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  it('handles multi-digit and zero components', () => {
    expect(parseVersion('v10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 })
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('rejects anything that is not exactly three integers', () => {
    // Each of these means "say nothing" rather than "guess" — the endpoint is
    // documented to return published, non-prerelease releases, so a tag in any
    // other shape means the assumption behind the check has moved.
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3.4')).toBeNull()
    expect(parseVersion('1.2.3-beta.1')).toBeNull()
    expect(parseVersion('1.2.x')).toBeNull()
    expect(parseVersion('release-1.2.3')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })

  it('rejects numeric shapes Number() would silently accept', () => {
    // Number('1e2') is 100 and Number('0x10') is 16; a coercion-based parser
    // would read `1.0x10` as a real version. The digit pattern is what stops it.
    expect(parseVersion('1.0.0x10')).toBeNull()
    expect(parseVersion('1.0.1e2')).toBeNull()
    expect(parseVersion('1. 0.0')).toBeNull()
    expect(parseVersion('1.-1.0')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('compares component by component, most significant first', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
  })

  it('is false for the same version — the common case, every launch', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false)
  })

  it('is false for older versions', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false)
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false)
  })

  it('compares numerically, not as strings', () => {
    // '10' < '9' lexically. A string compare would tell someone on 1.9.0 that
    // they are current while 1.10.0 is out.
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false)
    expect(isNewerVersion('10.0.0', '9.0.0')).toBe(true)
  })

  it('is false when either side does not parse', () => {
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false)
    expect(isNewerVersion('99.0.0', 'not-a-version')).toBe(false)
    // A prerelease cannot reach the banner even if the endpoint ever returned
    // one: unparseable means silence, not "newer than every release".
    expect(isNewerVersion('2.0.0-rc.1', '1.0.0')).toBe(false)
  })
})
