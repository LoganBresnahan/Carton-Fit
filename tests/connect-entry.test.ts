import { describe, expect, it } from 'vitest'
import {
  codexAddArgv,
  quotedCommandLine,
  sameEntry,
  shimEntry,
  tokenizeCommandLine,
  type ServerEntry
} from '../src/main/connect/entry'
import { MCP_SERVER_KEY } from '../src/shared/connect'

// The client-neutral launch entry and its two serialisers (ADR-0030 Decision
// 5), pinned at the unit layer.
//
// What is worth pinning here is not the entry — it is everything a serialiser
// could get wrong SILENTLY. An entry missing the one environment variable that
// makes it work on Windows, a `--` that stops separating our flags from
// Codex's, a path with a space in it that arrives at a shell as two arguments:
// none of those fail loudly in this app. They fail later, in a different
// program, as "the client doesn't see Carton Fit".

describe('shimEntry — the launch line every client will run', () => {
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

describe('codexAddArgv — the entry as Codex\u2019s own CLI takes it', () => {
  // The grammar probed on the requesting machine, 2026-09-02, and recorded in
  // ADR-0030's Context: `add <name> [--env K=V]\u2026 -- <command> [args\u2026]`.
  const entry: ServerEntry = {
    command: 'C:\\Program Files\\Carton Fit\\Carton Fit.exe',
    args: ['C:\\Program Files\\Carton Fit\\resources\\app.asar\\out\\main\\mcp.js', '--mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }

  it('names the server under our stable key and passes env as K=V', () => {
    expect(codexAddArgv(entry).slice(0, 5)).toEqual([
      'mcp',
      'add',
      MCP_SERVER_KEY,
      '--env',
      'ELECTRON_RUN_AS_NODE=1'
    ])
  })

  it('puts EVERY one of our arguments after the `--`', () => {
    const argv = codexAddArgv(entry)
    const separator = argv.indexOf('--')
    expect(separator).toBeGreaterThan(-1)
    // The one that bites: `--mcp` and `--user-data-dir=` are ours, and before
    // the separator they are Codex's flags to reject or, worse, to swallow.
    expect(argv.slice(separator + 1)).toEqual([entry.command, ...entry.args])
    expect(argv.indexOf('--mcp')).toBeGreaterThan(separator)
  })

  it('round-trips back to the same entry', () => {
    const argv = codexAddArgv(entry)
    const separator = argv.indexOf('--')
    const env = Object.fromEntries(
      argv
        .slice(0, separator)
        .filter((_token, i) => argv[i - 1] === '--env')
        .map((pair) => {
          const at = pair.indexOf('=')
          return [pair.slice(0, at), pair.slice(at + 1)]
        })
    )
    const [command, ...args] = argv.slice(separator + 1)
    expect(sameEntry({ command: command ?? '', args, env }, entry)).toBe(true)
  })

  it('emits no --env at all for an entry that carries none', () => {
    expect(codexAddArgv({ command: '/a', args: [] })).toEqual(['mcp', 'add', MCP_SERVER_KEY, '--', '/a'])
  })
})

describe('quotedCommandLine — the copyable fallback, on the paths Windows really has', () => {
  // `C:\Program Files` and a username with a space are not edge cases on the
  // primary target; they are the ordinary install. An unquoted join splits
  // each of them into two arguments, and what the user then sees is a client
  // that cannot find a program whose path is right there on their screen.
  const WINDOWS_ENTRY: ServerEntry = {
    command: 'C:\\Program Files\\Carton Fit\\Carton Fit.exe',
    args: [
      'C:\\Program Files\\Carton Fit\\resources\\app.asar\\out\\main\\mcp.js',
      '--mcp',
      '--user-data-dir=C:\\Users\\Dana Smith\\AppData\\Roaming\\Carton Fit'
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }

  it('leaves a token that needs no quoting alone', () => {
    expect(quotedCommandLine(['codex', 'mcp', 'add', MCP_SERVER_KEY])).toBe(
      `codex mcp add ${MCP_SERVER_KEY}`
    )
  })

  it('quotes every token with a space, and nothing else', () => {
    const line = quotedCommandLine(['codex', ...codexAddArgv(WINDOWS_ENTRY)])
    expect(line.startsWith(`codex mcp add ${MCP_SERVER_KEY} --env ELECTRON_RUN_AS_NODE=1 -- "C:`)).toBe(
      true
    )
    // The profile flag is one argument, space and all — a naive quoter that
    // wrapped only the path half would produce `--user-data-dir=C:\\Users\\Dana`
    // plus a stray `Smith\\...`, and the shim would boot a fresh empty profile.
    expect(line).toContain('"--user-data-dir=C:\\Users\\Dana Smith\\AppData\\Roaming\\Carton Fit"')
  })

  it('round-trips a Windows entry back through the tokenizer', () => {
    // Two independent readings of one documented rule (CommandLineToArgvW)
    // agreeing. That is all this proves — NOT that any given shell agrees,
    // which is dogfooding's job (ADR-0030 \u00a77).
    const tokens = tokenizeCommandLine(quotedCommandLine(codexAddArgv(WINDOWS_ENTRY)))
    const separator = tokens.indexOf('--')
    const [command, ...args] = tokens.slice(separator + 1)
    expect(
      sameEntry({ command: command ?? '', args, env: { ELECTRON_RUN_AS_NODE: '1' } }, WINDOWS_ENTRY)
    ).toBe(true)
  })

  it('survives a trailing backslash, which is what a directory path ends with', () => {
    // `"C:\dir\"` would escape its own closing quote and swallow the rest of
    // the line — the classic CommandLineToArgvW trap.
    const line = quotedCommandLine(['C:\\Program Files\\Carton Fit\\', '--mcp'])
    expect(tokenizeCommandLine(line)).toEqual(['C:\\Program Files\\Carton Fit\\', '--mcp'])
  })

  it('survives an embedded quote, the shape no shell agrees on', () => {
    // Our entries never contain one (see the module header); pinned so a
    // future one that does fails here rather than in someone's terminal.
    const line = quotedCommandLine(['say "hi"', 'x'])
    expect(tokenizeCommandLine(line)).toEqual(['say "hi"', 'x'])
  })
})
