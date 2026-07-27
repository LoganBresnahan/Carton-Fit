import { expect, test } from '@playwright/test'
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from './harness'

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

/**
 * The components the notices file names in its table, read from the file itself
 * rather than restated here — a package added to that table starts being
 * checked without anyone remembering to update this spec.
 */
function citedPackages(): string[] {
  const notices = readFileSync(join(REPO_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const names = notices
    .split('\n')
    .map((line) => /^\|\s*`([^`]+)`/.exec(line)?.[1]?.trim())
    .filter((name): name is string => name !== undefined)
  if (names.length === 0) throw new Error('parsed no components out of THIRD-PARTY-NOTICES.md')
  return names
}

test('every component the notices file cites ships its licence text', () => {
  const index = readAsarIndex(packagedAsar())
  const packages = citedPackages()

  for (const name of packages) {
    const dir = entryAt(index, `node_modules/${name}`)
    expect(dir, `${name} is cited in THIRD-PARTY-NOTICES.md but ships no directory at all`)
      .toBeDefined()

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
