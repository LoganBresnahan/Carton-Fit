import { expect, test } from '@playwright/test'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { citedPackages, inlineNotice } from './notices'

/**
 * THIRD-PARTY-NOTICES.md makes a checkable claim, so check it.
 *
 * The file ships inside the app (ADR-0011) and states: "Each component's full
 * notice ships with it inside the application archive." That is true only for
 * as long as each package's `LICENSE` is actually in there — and the packaging
 * exclusions that keep the app small are one careless glob away from making the
 * app assert something false about itself. That is a licence violation rather
 * than a size regression, and nothing else would catch it: deleting a licence
 * text breaks no feature and fails no other spec.
 *
 * Roadmap item 14 is what forced this. Its obvious form — "three and react-dom
 * are unreachable, exclude them" — would have deleted two cited notices while
 * every functional test stayed green, because the CODE those packages provide
 * still ships, bundled into out/renderer by vite. The obligation survives the
 * pruning even though the package does not.
 *
 * PACKAGED ONLY: a dev run has all of node_modules on disk, so every assertion
 * here would pass without proving anything about what ships.
 */
test.skip(!process.env.PACKAGED_APP, 'the exclusions under test only exist in a packaged build')

interface AsarEntry {
  files?: Record<string, AsarEntry>
  size?: number
}

/**
 * Read app.asar's index without unpacking it and without a dependency.
 *
 * The archive opens with four little-endian uint32s; the fourth is the length
 * of the JSON directory that follows at byte 16. That index carries each file's
 * SIZE, which is all this spec needs — so nothing here has to locate, decode or
 * trust the content region.
 *
 * Deliberately not `@electron/asar`: it is present only as a transitive
 * dependency of electron-builder, and a licence guard should not stop working
 * because an unrelated package reshuffled its tree.
 */
function readAsarIndex(archive: string): AsarEntry {
  const fd = openSync(archive, 'r')
  try {
    const preamble = Buffer.alloc(16)
    readSync(fd, preamble, 0, 16, 0)
    const jsonLength = preamble.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    return JSON.parse(json.toString('utf8')) as AsarEntry
  } finally {
    closeSync(fd)
  }
}

/** Walk a slash-separated path through the index. */
function entryAt(index: AsarEntry, path: string): AsarEntry | undefined {
  let node: AsarEntry | undefined = index
  for (const segment of path.split('/')) {
    node = node?.files?.[segment]
    if (node === undefined) return undefined
  }
  return node
}

function packagedAsar(): string {
  const packaged = process.env.PACKAGED_APP
  if (packaged === undefined) throw new Error('PACKAGED_APP must point at the packaged binary')
  return join(dirname(packaged), 'resources', 'app.asar')
}

test('every component the notices file cites ships its licence text', () => {
  const index = readAsarIndex(packagedAsar())
  const packages = citedPackages()

  for (const name of packages) {
    const dir = entryAt(index, `node_modules/${name}`)

    if (dir === undefined) {
      // No package directory in the archive. That is legitimate for exactly one
      // class of component — code BUNDLED into our own files (the MCP SDK and
      // its runtime subset, ADR-0029 phase 3) — and only if the notices file
      // itself carries the full licence text, since there is nowhere else for
      // it to ride. Anything cited, unshipped and not carried inline is the
      // careless-glob failure this spec exists to catch.
      const inline = inlineNotice(name)
      expect(
        inline,
        `${name} is cited in THIRD-PARTY-NOTICES.md but ships neither a package ` +
          'directory nor an inline "### Notice:" section carrying its licence text'
      ).not.toBeNull()
      // Substantial text, not a stub heading: the shortest real licence in the
      // set (ISC) runs ~750 characters.
      expect(
        (inline ?? '').trim().length,
        `${name}'s inline notice is too short to be a licence text`
      ).toBeGreaterThan(500)
      continue
    }

    const licences = Object.entries(dir?.files ?? {}).filter(([file]) =>
      /^(licen[cs]e|copying)/i.test(file)
    )
    expect(
      licences.map(([file]) => file),
      `${name} is cited in THIRD-PARTY-NOTICES.md but ships no licence text`
    ).not.toHaveLength(0)

    // Non-empty, not merely present: a zero-byte licence file satisfies every
    // existence check and grants nobody anything.
    for (const [file, entry] of licences) {
      expect(entry.size ?? 0, `${name}/${file} ships as an empty file`).toBeGreaterThan(100)
    }
  }
})

test('the notices file itself ships beside the binary', () => {
  // The inline notices above are only worth anything if their carrier is in
  // the distribution: THIRD-PARTY-NOTICES.md rides as an electron-builder
  // `extraFiles` entry into the application root. Deleting that mapping would
  // break no feature and fail no other spec — the exact failure shape that
  // justified this file.
  const packaged = process.env.PACKAGED_APP
  if (packaged === undefined) throw new Error('PACKAGED_APP must point at the packaged binary')
  const shipped = join(dirname(packaged), 'THIRD-PARTY-NOTICES.md')
  expect(statSync(shipped).size, `${shipped} is missing or empty`).toBeGreaterThan(1000)
})

test('the LGPL notices cited by path are exactly where the notices say', () => {
  // ADR-0011 cites these by FILE PATH rather than by URL, which makes them the
  // strictest case: the text a recipient is told to read has to be at the
  // address they were given. The compliance suite proves the wasm beside them is
  // substitutable; this proves the terms granting that right are readable.
  const cited = [
    'node_modules/occt-import-js/LICENSE.md',
    'node_modules/occt-import-js/dist/license.occt.txt',
    'node_modules/occt-import-js/dist/license.occt-import-js.txt'
  ]
  const index = readAsarIndex(packagedAsar())

  for (const path of cited) {
    const entry = entryAt(index, path)
    expect(entry, `${path} is missing from the packaged app`).toBeDefined()
    expect(entry?.size ?? 0, `${path} ships as an empty file`).toBeGreaterThan(100)
  }
})
