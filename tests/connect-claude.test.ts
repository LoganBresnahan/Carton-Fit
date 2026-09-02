import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chooseConfigDir,
  claudeConfigCandidates,
  claudeConfigFile,
  entryJson,
  mergeEntry,
  readConfig
} from '../src/main/connect/claudeConfig'
import { MCP_SERVER_KEY } from '../src/shared/connect'

// The Claude Desktop client's own half — its config paths, its JSON parse, its
// merge (ADR-0029 slice `connect-to-claude-button`; ADR-0030 Decision 2 makes
// the file the mechanism of last resort, taken here because Claude Desktop
// offers no tooling). The launch entry it writes is client-neutral and pinned
// in `connect-entry.test.ts`.
//
// What is worth pinning here is not the button — it is everything the button
// could get wrong SILENTLY. A config path that is right on Linux and wrong on
// Windows, a launch entry missing the one environment variable that makes it
// work, a merge that quietly drops somebody's other MCP servers: none of those
// fail loudly in this app. They fail later, in a different program, as
// "Claude Desktop doesn't see Carton Fit" or, worse, as someone else's server
// disappearing.

describe('claudeConfigCandidates — Claude Desktop ships two ways on Windows', () => {
  // The dogfooding bug, 2026-09-02: a Microsoft Store Claude Desktop was
  // plainly installed and the panel said it was not. MSIX virtualizes
  // %APPDATA%, so the packaged app's "%APPDATA%\Claude" is really
  // %LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude — a
  // path an unpackaged writer never sees. Both processes were right about
  // %APPDATA%; they were looking at different filesystems.
  const WIN = { APPDATA: 'C:\\U\\o\\Roaming', LOCALAPPDATA: 'C:\\U\\o\\Local' }

  it('offers the Store location FIRST, then the classic one', () => {
    expect(claudeConfigCandidates('win32', WIN, 'C:\\U\\o', ['Claude_pzs8sxrjxfjjc'])).toEqual([
      join('C:\\U\\o\\Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'),
      join('C:\\U\\o\\Roaming', 'Claude')
    ])
  })

  it('still answers with the classic path when no Store package is present', () => {
    // The non-Store install, and also every machine where the Packages
    // directory cannot be listed — the caller contributes no names and this
    // must not become an empty list.
    expect(claudeConfigCandidates('win32', WIN, 'C:\\U\\o', [])).toEqual([
      join('C:\\U\\o\\Roaming', 'Claude')
    ])
  })

  it('uses Application Support on macOS and XDG on Linux — one location each', () => {
    expect(claudeConfigCandidates('darwin', {}, '/Users/o')).toEqual([
      '/Users/o/Library/Application Support/Claude'
    ])
    expect(claudeConfigCandidates('linux', {}, '/home/o')).toEqual(['/home/o/.config/Claude'])
    expect(claudeConfigCandidates('linux', { XDG_CONFIG_HOME: '/x' }, '/home/o')).toEqual([
      '/x/Claude'
    ])
  })

  it('lets the environment own the path, and COLLAPSES the list to it', () => {
    // Collapsing matters as much as overriding: a test must never be at the
    // mercy of what Claude Desktop the running machine happens to have.
    const env = { CLAUDE_DESKTOP_CONFIG_DIR: '/tmp/fake', APPDATA: 'C:\\U\\o\\Roaming' }
    expect(claudeConfigCandidates('win32', env, '/home/o', ['Claude_x'])).toEqual(['/tmp/fake'])
    expect(claudeConfigFile('/tmp/fake')).toBe(join('/tmp/fake', 'claude_desktop_config.json'))
  })
})

describe('chooseConfigDir — which of them this machine actually has', () => {
  const store = '/local/Packages/Claude_x/LocalCache/Roaming/Claude'
  const classic = '/roaming/Claude'
  const none = (): boolean => false

  it('prefers a directory that HOLDS a config over one that merely exists', () => {
    // Both installed is the ambiguous case, and the file is the evidence of
    // which Claude Desktop is really in use. An empty directory proves nothing.
    const chosen = chooseConfigDir(
      [store, classic],
      () => true,
      (path) => path === claudeConfigFile(classic)
    )
    expect(chosen).toEqual({ dir: classic, found: true })
  })

  it('falls back to mere existence, in candidate order', () => {
    expect(chooseConfigDir([store, classic], (p) => p === store, none)).toEqual({
      dir: store,
      found: true
    })
  })

  it('reports not-found with the CLASSIC path, the one worth showing a user', () => {
    // This is the message the dogfooding bug produced. It must keep naming a
    // path a person can go and look at, not the last thing we happened to try.
    expect(chooseConfigDir([store, classic], none, none)).toEqual({
      dir: classic,
      found: false
    })
  })

  it('survives an empty candidate list without throwing', () => {
    expect(chooseConfigDir([], none, none)).toEqual({ dir: '', found: false })
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
      JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { command: '/a', args: ['x'] } } })
    )
    expect(good.ok && good.entry).toEqual({ command: '/a', args: ['x'], env: undefined })

    // Ours by key but not an entry we can understand: absent, so Connect
    // overwrites it. It is our key and it is not working.
    const junk = readConfig(JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { args: 3 } } }))
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
    expect(after['mcpServers'][MCP_SERVER_KEY]).toEqual(entry)
  })

  it('REPLACES a previous Carton Fit entry instead of accumulating installs', () => {
    // The key is stable across versions and profiles precisely so that
    // re-connecting after a move updates one entry rather than leaving a dead
    // one beside a live one (`shared/connect.ts`).
    const before = { mcpServers: { [MCP_SERVER_KEY]: { command: '/old', args: [] } } }
    const after = JSON.parse(mergeEntry(before, entry)) as Record<string, never>
    expect(Object.keys(after['mcpServers'])).toEqual([MCP_SERVER_KEY])
    expect(after['mcpServers'][MCP_SERVER_KEY]).toEqual(entry)
  })

  it('creates mcpServers when the config has none', () => {
    const after = JSON.parse(mergeEntry({ theme: 'dark' }, entry)) as Record<string, never>
    expect(after['theme']).toBe('dark')
    expect(after['mcpServers'][MCP_SERVER_KEY]).toEqual(entry)
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

describe('entryJson — the manual fallback for a client with no form of its own', () => {
  // Claude Desktop's own by-hand route is Settings → Developer → Edit Config,
  // which opens the file in a text editor — so a BLOCK is the right artifact
  // here, where Codex's discrete form fields are right there. Keyed by our
  // name so it drops in beside a user's other servers.
  const entry = {
    command: 'C:\\Program Files\\Carton Fit\\Carton Fit.exe',
    args: ['C:\\x\\mcp.js', '--mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }

  it('is the entry alone, without the wrapping braces a paste would duplicate', () => {
    const json = entryJson(entry)
    expect(json.startsWith('  "carton-fit": {')).toBe(true)
    expect(json.endsWith('  }')).toBe(true)
    // The outer object's braces must be gone: pasting them inside an existing
    // `mcpServers` would produce a config Claude Desktop refuses to read —
    // which is the very failure the whole fallback exists to route around.
    expect(json).not.toMatch(/^\{/)
    expect(json).not.toMatch(/\}$\n?\}/)
  })

  it('round-trips back through the parser it is meant to be pasted into', () => {
    // The real assertion: wrap it the way a user would and check that
    // `readConfig` — the same function that reads the file in anger — gets our
    // entry back out. A fallback nobody can parse is worse than none.
    const read = readConfig(`{ "mcpServers": {\n${entryJson(entry)}\n} }`)
    expect(read.ok).toBe(true)
    expect(read.ok && read.entry).toEqual(entry)
  })

  it('keeps the env that makes it work on Windows', () => {
    expect(entryJson(entry)).toContain('ELECTRON_RUN_AS_NODE')
  })
})
