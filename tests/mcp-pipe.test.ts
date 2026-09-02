import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { connect, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultUserDataPath, pipePath, profileKey } from '../src/main/mcp/pipePath'
import { servePipe } from '../src/main/mcp/pipeServer'
import { planShim, spawnTarget } from '../src/main/mcp/shim'

// The shim's plumbing (ADR-0029, slice `mcp-shim-single-instance`), pinned at
// the unit layer. The pieces here are exactly the ones whose failure would be
// a silent timeout in Claude Desktop rather than an error anywhere: a pipe
// name the two processes derive differently, a stale socket that blocks every
// future launch, a spawn command that works in dev and not packaged.

describe('pipePath — one profile, one name, from either process', () => {
  it('derives identical names for path spellings that are one profile', () => {
    // The app asks Electron; the shim resolves an argument. Trailing slashes
    // and relative segments must not become two pipes.
    expect(profileKey('/home/o/p/', 'linux')).toBe(profileKey('/home/o/p', 'linux'))
    expect(profileKey('/home/o/x/../p', 'linux')).toBe(profileKey('/home/o/p', 'linux'))
  })

  it('treats Windows case variants as one profile, and only Windows', () => {
    expect(profileKey('C:\\Users\\O\\AppData', 'win32')).toBe(
      profileKey('c:\\users\\o\\appdata', 'win32')
    )
    // On Linux those genuinely are different directories.
    expect(profileKey('/home/O', 'linux')).not.toBe(profileKey('/home/o', 'linux'))
  })

  it('scopes the name by profile — two profiles never share a pipe', () => {
    expect(pipePath('/p/one', 'linux', {})).not.toBe(pipePath('/p/two', 'linux', {}))
  })

  it('win32: a named pipe; elsewhere: a socket under the runtime dir', () => {
    expect(pipePath('C:\\u\\p', 'win32')).toMatch(/^\\\\\.\\pipe\\carton-fit-mcp-[0-9a-f]{16}$/)
    expect(pipePath('/p', 'linux', { XDG_RUNTIME_DIR: '/run/user/1000' })).toMatch(
      /^\/run\/user\/1000\/carton-fit-mcp-[0-9a-f]{16}\.sock$/
    )
    // No session runtime dir (CI, containers): the tmpdir, never userData —
    // profile paths have no length budget and socket paths cap around 104.
    expect(pipePath('/p', 'linux', {})).toContain(tmpdir())
  })

  it('restates Electron’s userData rule per platform, name un-spaced (ADR-0019)', () => {
    expect(defaultUserDataPath('win32', { APPDATA: 'C:\\Users\\o\\AppData\\Roaming' }, 'C:\\Users\\o')).toBe(
      join('C:\\Users\\o\\AppData\\Roaming', 'Carton-Fit')
    )
    expect(defaultUserDataPath('darwin', {}, '/Users/o')).toBe(
      '/Users/o/Library/Application Support/Carton-Fit'
    )
    expect(defaultUserDataPath('linux', {}, '/home/o')).toBe('/home/o/.config/Carton-Fit')
    expect(defaultUserDataPath('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/o')).toBe(
      '/cfg/Carton-Fit'
    )
  })
})

describe('servePipe — the listener the shim dials', () => {
  const open: Array<Server | Socket> = []
  afterEach(async () => {
    // Sockets first, servers after: a Server.close() waits for its
    // connections, so closing it while its client lives is a deadlock.
    const handles = open.splice(0)
    for (const handle of handles) if ('destroy' in handle) handle.destroy()
    for (const handle of handles) {
      if (!('destroy' in handle)) await new Promise<void>((resolve) => handle.close(() => resolve()))
    }
  })

  function sockPath(): string {
    return join(mkdtempSync(join(tmpdir(), 'pipe-test-')), 'mcp.sock')
  }

  it('serves connections and hands each socket to the session factory', async () => {
    const path = sockPath()
    const server = await servePipe(path, (socket) => {
      socket.on('data', (chunk: Buffer) => socket.write(chunk)) // echo session
    })
    open.push(server)

    const client = connect(path)
    open.push(client)
    const answer = await new Promise<string>((resolve) => {
      client.on('data', (chunk: Buffer) => resolve(chunk.toString('utf8')))
      client.on('connect', () => client.write('ping'))
    })
    expect(answer).toBe('ping')
    // The user's door and no one else's — 0600, not the tmpdir's default.
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('a stale socket file — the crash leftover — is cleaned up and served over', async () => {
    // The case that would otherwise brick every future launch on this
    // profile: a crash never runs net's unlink-on-close, so the file holds
    // EADDRINUSE forever. Faithfully reproduced: a REAL process listens and is
    // SIGKILLed — in-process there is no way to close a server without Node
    // tidying the file away, which is exactly the tidying a crash skips.
    const path = sockPath()
    const owner = spawn(process.execPath, [
      '-e',
      `require('net').createServer(() => {}).listen(${JSON.stringify(path)}, () => console.log('up'))`
    ])
    await new Promise<void>((resolve) => owner.stdout.once('data', () => resolve()))
    owner.kill('SIGKILL')
    await new Promise<void>((resolve) => owner.once('exit', () => resolve()))
    expect(existsSync(path)).toBe(true)

    const second = await servePipe(path, () => undefined)
    open.push(second)
    expect(second.listening).toBe(true)
  })

  it('a plain file squatting the name is treated as the corpse it is', async () => {
    const path = sockPath()
    writeFileSync(path, 'not a socket')
    const server = await servePipe(path, () => undefined)
    open.push(server)
    expect(server.listening).toBe(true)
  })

  it('REFUSES to steal a live instance’s socket', async () => {
    // The single-instance lock should make this unreachable; this is what
    // happens if it ever is not — loud failure, not two apps silently
    // splitting one identity.
    const path = sockPath()
    const alive = await servePipe(path, () => undefined)
    open.push(alive)
    await expect(servePipe(path, () => undefined)).rejects.toThrow(/already serving/)
    expect(alive.listening).toBe(true)
  })
})

describe('planShim — what the shim decides before touching anything', () => {
  it('uses the --user-data-dir it was handed, and passes everything through', () => {
    const plan = planShim(['--mcp', '--user-data-dir=/tmp/prof', '--use-angle=swiftshader'])
    expect(plan.userData).toBe('/tmp/prof')
    // --mcp is the shim's own flag; everything else reaches the app verbatim,
    // AFTER the server-mode flags, and --mcp-spawned is what tells the app
    // nobody holds its stdio.
    expect(plan.appArgs).toEqual([
      '--mcp-server',
      '--mcp-spawned',
      '--user-data-dir=/tmp/prof',
      '--use-angle=swiftshader'
    ])
  })

  it('falls back to the platform default profile — the Claude Desktop case', () => {
    const plan = planShim(['--mcp'], 'linux', { XDG_CONFIG_HOME: '/cfg' })
    expect(plan.userData).toBe('/cfg/Carton-Fit')
  })
})

describe('spawnTarget — dev and packaged launch the right binary', () => {
  const appArgs = ['--mcp-server', '--mcp-spawned']

  it('packaged: process.execPath IS the app', () => {
    expect(
      spawnTarget({
        isPackaged: true,
        appPath: '/opt/CartonFit/resources/app.asar',
        execPath: '/opt/CartonFit/carton-fit',
        electronBinary: () => {
          throw new Error('must not resolve node_modules in a packaged build')
        },
        appArgs
      })
    ).toEqual({ command: '/opt/CartonFit/carton-fit', args: appArgs })
  })

  it('a checkout: the dev Electron running the built entry', () => {
    expect(
      spawnTarget({
        isPackaged: false,
        appPath: '/home/o/Carton-Fit',
        execPath: '/usr/bin/node',
        electronBinary: () => '/home/o/Carton-Fit/node_modules/electron/dist/electron',
        appArgs
      })
    ).toEqual({
      command: '/home/o/Carton-Fit/node_modules/electron/dist/electron',
      args: ['/home/o/Carton-Fit/out/main/index.js', ...appArgs]
    })
  })
})
