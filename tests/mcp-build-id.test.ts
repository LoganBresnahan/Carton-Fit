import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIdFrom } from '../src/main/mcp/buildId'
import { resolveServerOptions } from '../src/main/mcp/host'
import { parseVersion } from '../src/main/version'

// WHICH BUILD IS ANSWERING (ADR-0029, slice `one-version-handshake`).
//
// ADR-0027's rule, applied to the MCP handshake instead of an installer's
// filename: a build that is not its release must not introduce itself as one.
// The derivation runs at BUILD time (electron-vite's define reads git), so
// these pin the rule against fabricated git states — the one thing a build
// cannot do is test itself against a repo it is not in.

describe('buildIdFrom', () => {
  const at = (over: Partial<Parameters<typeof buildIdFrom>[0]> = {}): string =>
    buildIdFrom({ version: '1.2.0', sha: '4f9f2f8', dirty: false, tags: [], ...over })

  it('a build at its own release tag says nothing', () => {
    // The whole point of the suffix is to distinguish everything else FROM
    // this: a released build's number has to be unadorned, or it stops
    // matching what the release page and the changelog say.
    expect(at({ tags: ['v1.2.0'] })).toBe('')
  })

  it('a build between releases names its sha', () => {
    expect(at()).toBe('+4f9f2f8')
  })

  it('a dirty tree is a snapshot even at a release tag', () => {
    // ADR-0027 §2: those are not the bytes the tag published. The tag being
    // present makes this MORE important to say, not less.
    expect(at({ dirty: true, tags: ['v1.2.0'] })).toBe('+4f9f2f8-dirty')
    expect(at({ dirty: true })).toBe('+4f9f2f8-dirty')
  })

  it("someone else's tag on this commit is not this build's release", () => {
    // A checkout sitting on v1.1.0 whose package.json already says 1.2.0 is a
    // release of neither. Matching the tag against THIS build's own version is
    // what keeps a stale tag from silently laundering a snapshot.
    expect(at({ tags: ['v1.1.0', 'nightly'] })).toBe('+4f9f2f8')
  })

  it('no git at all says nothing rather than guessing', () => {
    expect(at({ sha: null })).toBe('')
    // …and a dirty flag with no sha still says nothing: there is no sha to
    // name, and `+-dirty` would be a suffix carrying no identity.
    expect(at({ sha: null, dirty: true })).toBe('')
  })
})

describe('the stamp reaches the handshake', () => {
  function rootWithVersion(version: string): string {
    const root = mkdtempSync(join(tmpdir(), 'build-id-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
    return root
  }

  it('appends the build id to the version the server introduces itself with', () => {
    const root = rootWithVersion('1.2.0')
    expect(resolveServerOptions(join(root, 'out', 'main'), '+4f9f2f8').version).toBe(
      '1.2.0+4f9f2f8'
    )
  })

  it('a release build reports the bare number', () => {
    const root = rootWithVersion('1.2.0')
    expect(resolveServerOptions(join(root, 'out', 'main'), '').version).toBe('1.2.0')
  })

  it('leaves the UPDATE CHECK’s version untouched — it must stay parseable', () => {
    // The trap this slice was written around. `version.ts` rejects a build
    // suffix on purpose (ADR-0021 §3: anything it cannot parse means say
    // nothing), so stamping the version at its source — `package.json`, or
    // `app.getVersion()` — would buy a truthful handshake by making the update
    // check permanently silent. The suffix exists only on the wire; the string
    // the update check compares is still a bare three-number version.
    expect(parseVersion('1.2.0+4f9f2f8')).toBeNull()
    expect(parseVersion('1.2.0')).toEqual({ major: 1, minor: 2, patch: 0 })
  })
})
