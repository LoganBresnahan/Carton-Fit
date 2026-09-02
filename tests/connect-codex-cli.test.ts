import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexBinRoot, codexHome, findCodexCli, type CodexLookup } from '../src/main/connect/codexCli'

// Finding Codex's CLI (ADR-0030 Decision 4), pinned at the unit layer.
//
// Every interesting branch here is a WINDOWS branch — the versioned `bin`, the
// mtime ranking, the `.exe` suffix — and the only machine our CI has is Linux.
// So the whole lookup is injected, exactly like `claudeConfigCandidates`, and
// the Windows shapes are tested on the machine that will never run them.
//
// What a failure here looks like in the world: a user with Codex installed
// sees "not detected" and has no way to connect, or — worse — we resolve a
// different CLI on two consecutive checks and the panel flickers between
// connected and outdated for no reason the user can see.

const WIN_ENV = { LOCALAPPDATA: 'C:\\U\\o\\Local', PATH: '' }
const BIN = join('C:\\U\\o\\Local', 'OpenAI', 'Codex', 'bin')

function lookup(over: Partial<CodexLookup> = {}): CodexLookup {
  return {
    platform: 'win32',
    env: WIN_ENV,
    home: 'C:\\U\\o',
    listBinDirs: () => [],
    exists: () => false,
    ...over
  }
}

describe('codexBinRoot / codexHome — computed, and one of them never opened', () => {
  it('finds the desktop install’s versioned bin under LOCALAPPDATA', () => {
    expect(codexBinRoot(WIN_ENV, 'C:\\U\\o')).toBe(BIN)
    // No LOCALAPPDATA at all still yields the conventional location rather
    // than something rooted at ''.
    expect(codexBinRoot({}, 'C:\\U\\o')).toBe(join('C:\\U\\o', 'AppData', 'Local', 'OpenAI', 'Codex', 'bin'))
  })

  it('honours CODEX_HOME, else ~/.codex — and it is only ever passed on', () => {
    expect(codexHome({}, '/home/o')).toBe(join('/home/o', '.codex'))
    expect(codexHome({ CODEX_HOME: '/tmp/throwaway' }, '/home/o')).toBe('/tmp/throwaway')
    // Empty is not a choice: an env var set to '' must not send the CLI to
    // the filesystem root.
    expect(codexHome({ CODEX_HOME: '' }, '/home/o')).toBe(join('/home/o', '.codex'))
  })
})

describe('findCodexCli — the CODEX_CLI seam', () => {
  it('wins over everything, and is NOT existence-checked', () => {
    // The e2e fake CLI is installed through this. A test pointing it at a
    // missing file wants a loud spawn failure, not a silent fall-through to
    // whatever the machine running the suite happens to have installed.
    expect(
      findCodexCli(lookup({ env: { ...WIN_ENV, CODEX_CLI: '/tmp/fake-codex' }, exists: () => true }))
    ).toBe('/tmp/fake-codex')
  })

  it('is ignored when empty, rather than resolving to nothing', () => {
    expect(findCodexCli(lookup({ env: { ...WIN_ENV, CODEX_CLI: '' } }))).toBeNull()
  })
})

describe('findCodexCli — the Windows desktop install', () => {
  it('takes the newest version directory', () => {
    const found = findCodexCli(
      lookup({
        listBinDirs: () => [
          { name: 'aaa', mtimeMs: 100 },
          { name: 'zzz', mtimeMs: 900 }
        ],
        exists: (path) => path === join(BIN, 'zzz', 'codex.exe')
      })
    )
    expect(found).toBe(join(BIN, 'zzz', 'codex.exe'))
  })

  it('falls through a newest directory that has no codex.exe in it', () => {
    // A half-written update must not read as "Codex is not installed" — the
    // previous version is still there and still works.
    const found = findCodexCli(
      lookup({
        listBinDirs: () => [
          { name: 'old', mtimeMs: 100 },
          { name: 'new', mtimeMs: 900 }
        ],
        exists: (path) => path === join(BIN, 'old', 'codex.exe')
      })
    )
    expect(found).toBe(join(BIN, 'old', 'codex.exe'))
  })

  it('breaks an mtime tie the SAME WAY twice', () => {
    // The two versions on the requesting machine were installed minutes apart
    // by one update, so equal mtimes are not hypothetical. Any answer will do;
    // an answer that changes between calls would flicker the panel.
    const dirs = [
      { name: 'bbb', mtimeMs: 500 },
      { name: 'aaa', mtimeMs: 500 }
    ]
    const probe = (order: typeof dirs): string | null =>
      findCodexCli(lookup({ listBinDirs: () => order, exists: () => true }))
    expect(probe(dirs)).toBe(probe([...dirs].reverse()))
    expect(probe(dirs)).toBe(join(BIN, 'bbb', 'codex.exe'))
  })

  it('reports nothing when the bin is empty or absent', () => {
    expect(findCodexCli(lookup())).toBeNull()
  })
})

describe('findCodexCli — PATH', () => {
  it('is the whole of discovery off Windows', () => {
    const found = findCodexCli(
      lookup({
        platform: 'linux',
        env: { PATH: ['/usr/bin', '/home/o/.local/bin'].join(':') },
        exists: (path) => path === '/home/o/.local/bin/codex'
      })
    )
    expect(found).toBe('/home/o/.local/bin/codex')
  })

  it('backs up the desktop install on Windows too', () => {
    // The ADR's sketch gives Windows only the versioned bin. An npm-installed
    // codex on a Windows box is a real shape, and the only thing this can
    // change is `not-detected` → found. Split on ';', because a Windows PATH
    // split on ':' tears every drive letter off its own entry.
    const found = findCodexCli(
      lookup({
        env: { ...WIN_ENV, PATH: 'C:\\other;C:\\tools' },
        exists: (path) => path === join('C:\\tools', 'codex.exe')
      })
    )
    expect(found).toBe(join('C:\\tools', 'codex.exe'))
  })

  it('SKIPS an empty PATH entry rather than resolving the current directory', () => {
    // Some shells read '' as '.'. Honouring that would let whatever directory
    // the app happens to be running in supply a program we then execute.
    const seen: string[] = []
    findCodexCli(
      lookup({
        platform: 'linux',
        env: { PATH: '::/usr/bin:' },
        exists: (path) => {
          seen.push(path)
          return false
        }
      })
    )
    expect(seen).toEqual(['/usr/bin/codex'])
  })

  it('survives no PATH at all', () => {
    expect(findCodexCli(lookup({ platform: 'linux', env: {} }))).toBeNull()
  })
})
