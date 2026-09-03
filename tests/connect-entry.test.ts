import { describe, expect, it } from 'vitest'
import {
  codexAddArgv,
  codexManualFields,
  sameEntry,
  sessionEnvKeys,
  shimEntry,
  type ServerEntry
} from '../src/main/connect/entry'
import { pickClient, type ConnectClient } from '../src/main/connect/registry'
import { MCP_SERVER_KEY, type ClientStatus } from '../src/shared/connect'

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
  const session = { HOME: '/home/o', DISPLAY: ':0', PATH: '/usr/bin', IRRELEVANT: 'x' }
  const base = {
    execPath: '/opt/Carton Fit/carton-fit',
    appPath: '/opt/Carton Fit/resources/app.asar',
    userData: '/home/o/.config/Carton-Fit',
    defaultUserData: '/home/o/.config/Carton-Fit',
    platform: 'linux' as NodeJS.Platform,
    env: session as NodeJS.ProcessEnv
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
    expect(entry.env?.['ELECTRON_RUN_AS_NODE']).toBe('1')
  })

  it('carries what the session supplies, and nothing it does not', () => {
    // The ADR-0030 addendum-3 invariant: THE ENTRY MUST LAUNCH FROM AN EMPTY
    // ENVIRONMENT, because Codex hands a stdio child only what the entry
    // declares. Reproduced before the fix as a ChatGPT that listed Carton Fit
    // and advertised no tools.
    const entry = shimEntry(base)
    expect(entry.env?.['HOME']).toBe('/home/o')
    expect(entry.env?.['DISPLAY']).toBe(':0')
    // Not ours to carry: an entry is a launch, not a copy of someone's shell.
    expect(entry.env?.['IRRELEVANT']).toBeUndefined()
  })

  it('skips a variable the session does not set, rather than blanking it', () => {
    // A key present-but-empty would satisfy `sameEntry`'s presence check while
    // being exactly as useless as an absent one — and on Windows an empty TEMP
    // is worse than none.
    const entry = shimEntry({ ...base, env: { HOME: '/home/o', DISPLAY: '' } })
    expect(entry.env?.['DISPLAY']).toBeUndefined()
    expect('DISPLAY' in (entry.env ?? {})).toBe(false)
  })

  it('asks each platform for its own session variables', () => {
    // Windows needs its system root and profile paths; Linux needs a display.
    // Neither list can be tested on the other's machine, so the list itself is
    // what a test can hold.
    expect(sessionEnvKeys('win32')).toContain('SystemRoot')
    expect(sessionEnvKeys('win32')).toContain('APPDATA')
    expect(sessionEnvKeys('linux')).toContain('DISPLAY')
    // Reason 2 in the module: these decide where the pipe lives, so a shim
    // without them looks for a rendezvous the running app never opened.
    expect(sessionEnvKeys('linux')).toContain('XDG_RUNTIME_DIR')
    expect(sessionEnvKeys('darwin')).toContain('HOME')
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
      ...base,
      execPath: '/repo/node_modules/electron/dist/electron',
      appPath: '/repo'
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
    expect(sameEntry(entry, { command: '/a', args: entry.args, env: { X: '2' } })).toBe(false)
  })

  it('reads an entry written before the session variables as outdated', () => {
    // THE UPGRADE PATH, and the reason the check is by presence rather than by
    // equality of the whole map. Every entry written before ADR-0030 addendum 3
    // carries ELECTRON_RUN_AS_NODE alone — the shape that reaches ChatGPT as a
    // server with no tools. It must read `outdated` so the panel offers the one
    // click that fixes it.
    const old = { command: '/a', args: ['/a/out/main/mcp.js', '--mcp'], env: { E: '1' } }
    const now = { ...old, env: { E: '1', HOME: '/home/o', DISPLAY: ':0' } }
    expect(sameEntry(old, now)).toBe(false)
    expect(sameEntry(now, now)).toBe(true)
  })

  it('ignores a variable the user added, and a PATH that has moved on', () => {
    const ours = { command: '/a', args: [], env: { E: '1', PATH: '/usr/bin', HOME: '/home/o' } }
    // Somebody's own addition in their client's form. Reporting that as
    // outdated would offer to overwrite their work every time the panel opens.
    expect(sameEntry({ ...ours, env: { ...ours.env, THEIRS: 'x' } }, ours)).toBe(true)
    // PATH grows whenever anything is installed; nagging on it would train a
    // user to ignore the one state that means something.
    expect(sameEntry({ ...ours, env: { ...ours.env, PATH: '/usr/bin:/opt/x' } }, ours)).toBe(true)
    // Present is still required, though: a PATH-less entry is not this launch.
    expect(sameEntry({ ...ours, env: { E: '1', HOME: '/home/o' } }, ours)).toBe(false)
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

describe('codexManualFields — the values a person retypes into Codex’s own form', () => {
  // Codex's "Connect to a custom MCP" form takes the command in one box and
  // EACH ARGUMENT IN ITS OWN, added a row at a time, with environment
  // variables as separate Key and Value inputs. So the fallback is fields, not
  // a command line: a user who has to split a quoted line by hand — at the
  // moment they are already stuck, on paths containing spaces — will get it
  // wrong, and that is the one moment we cannot afford to make harder.
  const entry: ServerEntry = {
    command: 'C:\\Program Files\\Carton Fit\\Carton Fit.exe',
    args: ['C:\\Program Files\\Carton Fit\\resources\\app.asar\\out\\main\\mcp.js', '--mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }

  it('gives one field per box the form actually has', () => {
    expect(codexManualFields(entry)).toEqual([
      { label: 'Name', value: MCP_SERVER_KEY },
      { label: 'Type', value: 'STDIO' },
      { label: 'Command to launch', value: 'C:\\Program Files\\Carton Fit\\Carton Fit.exe' },
      {
        label: 'Argument 1',
        value: 'C:\\Program Files\\Carton Fit\\resources\\app.asar\\out\\main\\mcp.js'
      },
      { label: 'Argument 2', value: '--mcp' },
      { label: 'Environment variable — ELECTRON_RUN_AS_NODE', value: '1' }
    ])
  })

  it('carries values RAW — no quoting, because a form field is not a shell', () => {
    // Quoting here would be actively harmful: the user pastes into a text
    // input, and a stray pair of quotes becomes part of the path.
    const command = codexManualFields(entry).find((f) => f.label === 'Command to launch')
    expect(command?.value).not.toContain('"')
    expect(command?.value).toBe(entry.command)
  })

  it('grows a row when the profile flag is present', () => {
    const withProfile = { ...entry, args: [...entry.args, '--user-data-dir=C:\\tmp\\p9'] }
    const labels = codexManualFields(withProfile).map((f) => f.label)
    expect(labels).toContain('Argument 3')
    // The flag must travel or the shim answers on the wrong pipe — the same
    // property `shimEntry` guards, restated where a human does the typing.
    expect(codexManualFields(withProfile).at(-2)?.value).toBe('--user-data-dir=C:\\tmp\\p9')
  })
})

describe('pickClient — the one line that keeps ADR-0029’s security property', () => {
  // `connect(id)` is the only argument the renderer ever sends across this
  // surface. It must select from what MAIN registered and nothing else: never
  // a path, never a command, never content. A registry that fell back to
  // "something" for an unknown id would be a registry page content could steer.
  const fake = (id: ConnectClient['id']): ConnectClient => ({
    id,
    displayName: id,
    status: async (): Promise<ClientStatus> => ({ id, displayName: id, state: 'not-detected', location: '' }),
    connect: async (): Promise<ClientStatus> => ({ id, displayName: id, state: 'connected', location: '' })
  })
  const clients = [fake('claude-desktop'), fake('codex')]

  it('returns the registered client for a registered id', () => {
    expect(pickClient(clients, 'codex').id).toBe('codex')
  })

  it('REFUSES anything else, including near-misses and non-strings', () => {
    for (const bad of ['bogus', 'Codex', '', undefined, null, 0, {}, ['codex']]) {
      expect(() => pickClient(clients, bad), `accepted ${JSON.stringify(bad)}`).toThrow(
        /Unknown connect client/
      )
    }
  })

  it('refuses rather than defaulting when nothing is registered', () => {
    expect(() => pickClient([], 'claude-desktop')).toThrow()
  })
})
