import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAppRoot, resolveServerOptions } from '../src/main/mcp/host'

// The headless host's Electron-free answers to Electron's questions (ADR-0029,
// slice `mcp-server-host-in-main`). The path shapes are the contract: the entry
// is built to <appPath>/out/main/mcp.js in BOTH layouts, and everything the
// server needs is derived from that fact alone. The e2e proves the derivation
// against a real packaged build; these pin the rule itself, including the
// packaged shape, without needing one.

describe('resolveAppRoot', () => {
  it('a repo checkout: out/main under the project root, not packaged', () => {
    expect(resolveAppRoot('/home/someone/Carton-Fit/out/main')).toEqual({
      appPath: '/home/someone/Carton-Fit',
      isPackaged: false
    })
  })

  it('a packaged app: out/main inside app.asar, packaged', () => {
    const dir = '/opt/CartonFit/resources/app.asar/out/main'
    expect(resolveAppRoot(dir)).toEqual({
      appPath: '/opt/CartonFit/resources/app.asar',
      isPackaged: true
    })
  })

  it('is not fooled by an asar-ish name elsewhere in the path', () => {
    // A user may keep the REPO somewhere odd; only the app root itself being
    // an asar means packaged, because that is the only layout electron-builder
    // produces. `foo.asar` as a plain parent directory name would still end
    // with `.asar` — the rule keys on the derived root, so a checkout under
    // a directory merely CONTAINING ".asar" stays a checkout.
    expect(resolveAppRoot('/data/backups.asar-2026/Carton-Fit/out/main')).toEqual({
      appPath: '/data/backups.asar-2026/Carton-Fit',
      isPackaged: false
    })
  })
})

describe('resolveServerOptions', () => {
  it('reads the version app.getVersion() would have read', () => {
    // A fake app root with the packaged layout's package.json: the version on
    // the wire must come from the same file in both modes, or one build could
    // introduce itself with two numbers.
    const root = mkdtempSync(join(tmpdir(), 'host-test-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }))
    const options = resolveServerOptions(join(root, 'out', 'main'))
    expect(options.version).toBe('9.9.9')
    expect(options.occt).toEqual({ appPath: root, isPackaged: false })
  })

  it('a root without a readable version fails loudly, not as "undefined"', () => {
    const root = mkdtempSync(join(tmpdir(), 'host-test-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'no-version' }))
    expect(() => resolveServerOptions(join(root, 'out', 'main'))).toThrow(/no version/)
  })
})
