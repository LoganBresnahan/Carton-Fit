import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codexBinRoot,
  codexHome,
  findCodexCli,
  parseCodexGet,
  type CodexLookup
} from '../src/main/connect/codexCli'

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
    // NOT hypothetical — this is the requesting machine, 2026-09-02. Its `bin`
    // holds one directory per bundled TOOL, not per version, and the newer of
    // the two (by three seconds) contains `rg.exe` alone. Ranking by mtime
    // without this fall-through reports Codex as absent on the machine that
    // asked for the feature.
    const found = findCodexCli(
      lookup({
        listBinDirs: () => [
          { name: '87e5fb3433dabab1', mtimeMs: 1788369334000 },
          { name: 'fce30c272acde6f9', mtimeMs: 1788369337000 }
        ],
        exists: (path) => path === join(BIN, '87e5fb3433dabab1', 'codex.exe')
      })
    )
    expect(found).toBe(join(BIN, '87e5fb3433dabab1', 'codex.exe'))
  })

  it('breaks an mtime tie the SAME WAY twice', () => {
    // The requesting machine's two directories were written three seconds
    // apart, so near-equal mtimes are the norm rather than a curiosity. Any
    // answer will do; one that changes between calls would flicker the panel.
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

describe('parseCodexGet — reading another program’s JSON, sceptically', () => {
  const good = JSON.stringify({
    transport: {
      command: 'C:\\app\\Carton Fit.exe',
      args: ['C:\\app\\mcp.js', '--mcp'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    },
    enabled: true
  })

  it('reads the shape the CLI was probed to produce', () => {
    const server = parseCodexGet(good)
    expect(server?.entry).toEqual({
      command: 'C:\\app\\Carton Fit.exe',
      args: ['C:\\app\\mcp.js', '--mcp'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    expect(server?.enabled).toBe(true)
  })

  it('treats a missing `enabled` as ON, because it is an opt-OUT', () => {
    expect(parseCodexGet(JSON.stringify({ transport: { command: '/a' } }))?.enabled).toBe(true)
    expect(parseCodexGet(JSON.stringify({ transport: { command: '/a' }, enabled: false }))?.enabled).toBe(
      false
    )
  })

  it('defaults absent args to empty rather than dropping the entry', () => {
    expect(parseCodexGet(JSON.stringify({ transport: { command: '/a' } }))?.entry.args).toEqual([])
  })

  it('REFUSES anything it cannot read as a transport', () => {
    // Each of these means "the CLI's contract moved under us", which the
    // adapter turns into a loud error rather than a silent offer to re-add a
    // server that is already there. ADR-0030's first revisit trigger.
    expect(parseCodexGet('not json at all')).toBeNull()
    expect(parseCodexGet('[]')).toBeNull()
    expect(parseCodexGet('"a string"')).toBeNull()
    expect(parseCodexGet(JSON.stringify({ enabled: true }))).toBeNull()
    expect(parseCodexGet(JSON.stringify({ transport: 'npx' }))).toBeNull()
    expect(parseCodexGet(JSON.stringify({ transport: { command: 7 } }))).toBeNull()
    expect(parseCodexGet(JSON.stringify({ transport: { command: '/a', args: 'x' } }))).toBeNull()
    expect(parseCodexGet(JSON.stringify({ transport: { command: '/a', args: [1] } }))).toBeNull()
  })

  it('ignores non-string env values instead of failing the whole read', () => {
    // An entry is still usable when one env value is odd; refusing the lot
    // would report "ChatGPT updated" over a triviality.
    const server = parseCodexGet(
      JSON.stringify({ transport: { command: '/a', env: { A: '1', B: 2 } } })
    )
    expect(server?.entry.env).toEqual({ A: '1' })
  })
})
