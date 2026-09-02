import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claudeConfigDir,
  claudeConfigPath,
  mergeEntry,
  readConfig,
  sameEntry,
  shimEntry
} from '../src/main/claudeConfig'
import { CLAUDE_SERVER_KEY } from '../src/shared/claudeConnect'

// "Connect to Claude" (ADR-0029, slice `connect-to-claude-button`), pinned at
// the unit layer.
//
// What is worth pinning here is not the button — it is everything the button
// could get wrong SILENTLY. A config path that is right on Linux and wrong on
// Windows, a launch entry missing the one environment variable that makes it
// work, a merge that quietly drops somebody's other MCP servers: none of those
// fail loudly in this app. They fail later, in a different program, as
// "Claude Desktop doesn't see Carton Fit" or, worse, as someone else's server
// disappearing.

const NO_HOME_ENV = {} as NodeJS.ProcessEnv

describe('claudeConfigDir — Claude Desktop’s own locations', () => {
  it('follows APPDATA on Windows, and falls back to its default shape', () => {
    expect(claudeConfigDir('win32', { APPDATA: 'C:\\Users\\o\\AppData\\Roaming' }, 'C:\\Users\\o')).toBe(
      // `join` on the running platform, the same way tests/mcp-pipe.test.ts
      // pins the userData twin: what matters is the shape, not the separator
      // this machine happens to use.
      join('C:\\Users\\o\\AppData\\Roaming', 'Claude')
    )
    expect(claudeConfigDir('win32', NO_HOME_ENV, 'C:/Users/o')).toContain('AppData')
  })

  it('uses Application Support on macOS and XDG on Linux', () => {
    expect(claudeConfigDir('darwin', NO_HOME_ENV, '/Users/o')).toBe(
      '/Users/o/Library/Application Support/Claude'
    )
    expect(claudeConfigDir('linux', NO_HOME_ENV, '/home/o')).toBe('/home/o/.config/Claude')
    expect(claudeConfigDir('linux', { XDG_CONFIG_HOME: '/x' }, '/home/o')).toBe('/x/Claude')
  })

  it('lets the environment own the path, so tests never touch a real install', () => {
    // The ADR-0021 seam, reused: the e2e writes a real config into a temp dir.
    expect(claudeConfigDir('linux', { CLAUDE_DESKTOP_CONFIG_DIR: '/tmp/fake' }, '/home/o')).toBe(
      '/tmp/fake'
    )
    expect(claudeConfigPath('linux', { CLAUDE_DESKTOP_CONFIG_DIR: '/tmp/fake' }, '/home/o')).toBe(
      '/tmp/fake/claude_desktop_config.json'
    )
  })
})

describe('shimEntry — the launch line Claude Desktop will run', () => {
  const base = {
    execPath: '/opt/Carton Fit/carton-fit',
    appPath: '/opt/Carton Fit/resources/app.asar',
    userData: '/home/o/.config/Carton-Fit',
    defaultUserData: '/home/o/.config/Carton-Fit'
  }

  it('runs the built shim entry under run-as-node', () => {
    const entry = shimEntry(base)
    expect(entry.command).toBe('/opt/Carton Fit/carton-fit')
    expect(entry.args).toEqual([
      '/opt/Carton Fit/resources/app.asar/out/main/mcp.js',
      '--mcp'
    ])
    // The whole Windows finding rides on this variable: without it Claude
    // Desktop launches a GUI process whose stdin never arrives, and the
    // session hangs forever with no error anywhere.
    expect(entry.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('omits the profile flag on the default profile and adds it otherwise', () => {
    expect(shimEntry(base).args).not.toContain('--user-data-dir=/home/o/.config/Carton-Fit')
    // A non-default profile MUST travel: the pipe is named per-profile, so an
    // entry without it sends Claude to a universe with no app listening.
    expect(shimEntry({ ...base, userData: '/tmp/p9' }).args).toContain('--user-data-dir=/tmp/p9')
  })

  it('works unchanged from a repo checkout', () => {
    // `process.execPath` is the Electron binary in both layouts — packaged the
    // installed app, in a checkout node_modules/electron — so one rule covers
    // both and only appPath differs.
    const entry = shimEntry({
      execPath: '/repo/node_modules/electron/dist/electron',
      appPath: '/repo',
      userData: '/home/o/.config/Carton-Fit',
      defaultUserData: '/home/o/.config/Carton-Fit'
    })
    expect(entry.args[0]).toBe('/repo/out/main/mcp.js')
  })
})

describe('sameEntry — connected vs. outdated', () => {
  const entry = { command: '/a', args: ['/a/out/main/mcp.js', '--mcp'], env: { X: '1' } }

  it('is true only for an entry naming this exact launch', () => {
    expect(sameEntry(entry, { ...entry, args: [...entry.args] })).toBe(true)
    // An app that moved: same key, different binary. That is `outdated`, which
    // the UI offers to fix, rather than `connected`, which it would not.
    expect(sameEntry(entry, { ...entry, command: '/b' })).toBe(false)
    expect(sameEntry(entry, { ...entry, args: ['/a/out/main/mcp.js'] })).toBe(false)
    expect(sameEntry(entry, { ...entry, env: {} })).toBe(false)
  })
})

describe('readConfig — rule 2: when in doubt, refuse', () => {
  it('treats a missing or empty config as a fresh start, not as damage', () => {
    // Claude Desktop ships without this file, so absence is the ordinary case.
    for (const text of [null, '', '   \n']) {
      const read = readConfig(text)
      expect(read.ok && read.entry).toBe(null)
    }
  })

  it('REFUSES unparseable JSON rather than starting over', () => {
    // The failure this prevents: a file we cannot read is not a blank one. It
    // may hold every other server the user has configured, and "start fresh"
    // would delete all of them to add one.
    const read = readConfig('{ "mcpServers": {,,, }')
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.problem).toMatch(/not valid JSON/)
  })

  it('refuses a config, or an mcpServers, that is not an object', () => {
    expect(readConfig('[1,2]').ok).toBe(false)
    expect(readConfig('"hello"').ok).toBe(false)
    expect(readConfig('{"mcpServers": ["a"]}').ok).toBe(false)
  })

  it('reads our entry back, and treats an unreadable one as absent', () => {
    const good = readConfig(
      JSON.stringify({ mcpServers: { [CLAUDE_SERVER_KEY]: { command: '/a', args: ['x'] } } })
    )
    expect(good.ok && good.entry).toEqual({ command: '/a', args: ['x'], env: undefined })

    // Ours by key but not an entry we can understand: absent, so Connect
    // overwrites it. It is our key and it is not working.
    const junk = readConfig(JSON.stringify({ mcpServers: { [CLAUDE_SERVER_KEY]: { args: 3 } } }))
    expect(junk.ok && junk.entry).toBe(null)
  })
})

describe('mergeEntry — rule 1: merge, never clobber', () => {
  const entry = { command: '/a', args: ['/a/out/main/mcp.js', '--mcp'], env: { E: '1' } }

  it('keeps every other server and every other top-level key', () => {
    const before = {
      globalShortcut: 'Alt+Space',
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
      }
    }
    const after = JSON.parse(mergeEntry(before, entry)) as Record<string, never>
    expect(after['globalShortcut']).toBe('Alt+Space')
    expect(after['mcpServers']['filesystem']).toEqual(before.mcpServers.filesystem)
    expect(after['mcpServers'][CLAUDE_SERVER_KEY]).toEqual(entry)
  })

  it('REPLACES a previous Carton Fit entry instead of accumulating installs', () => {
    // The key is stable across versions and profiles precisely so that
    // re-connecting after a move updates one entry rather than leaving a dead
    // one beside a live one (`shared/claudeConnect.ts`).
    const before = { mcpServers: { [CLAUDE_SERVER_KEY]: { command: '/old', args: [] } } }
    const after = JSON.parse(mergeEntry(before, entry)) as Record<string, never>
    expect(Object.keys(after['mcpServers'])).toEqual([CLAUDE_SERVER_KEY])
    expect(after['mcpServers'][CLAUDE_SERVER_KEY]).toEqual(entry)
  })

  it('creates mcpServers when the config has none', () => {
    const after = JSON.parse(mergeEntry({ theme: 'dark' }, entry)) as Record<string, never>
    expect(after['theme']).toBe('dark')
    expect(after['mcpServers'][CLAUDE_SERVER_KEY]).toEqual(entry)
  })

  it('writes the shape Claude Desktop writes — 2-space JSON, trailing newline', () => {
    // So connecting does not show up as a whole-file reformat in anyone's
    // dotfile repo, and key order survives (spread, not rebuild).
    const text = mergeEntry({ a: 1, mcpServers: {}, z: 2 }, entry)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "mcpServers": {')
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['a', 'mcpServers', 'z'])
  })
})
