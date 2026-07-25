#!/usr/bin/env node
// Assert that Electron's embedded-ASAR-integrity validation is DISABLED in a
// packaged binary — a licence-compliance check, not a security one (ADR-0011).
//
// WHY THIS EXISTS
// occt-import-js is LGPL-2.1, and we honour the LGPL's replace-the-library right
// concretely: the OCCT .wasm is kept outside app.asar (`asarUnpack`) so a
// recipient can drop in their own build with a file copy. If Electron ever
// enforces embedded ASAR integrity, a substituted library would be rejected at
// load — the guarantee silently becomes false while every other test stays
// green. That is the exact failure mode this guards.
//
// The Windows build logs "updating asar integrity executable resource", so
// electron-builder DOES embed integrity hashes there. Embedding is not
// enforcing: enforcement is the EnableEmbeddedAsarIntegrityValidation fuse.
// This script measures the fuse rather than inferring from either fact.
//
// HOW
// Electron stores fuses as a plain wire in the binary: a sentinel string,
// then a version byte, a length byte, and one ASCII byte per fuse
// ('0' disabled, '1' enabled, 'r' removed). No dependency needed to read it —
// deliberately, since @electron/fuses would be a new dep for ~30 lines.
//
// Usage:
//   node scripts/check-asar-integrity-fuse.mjs <path-to-binary>
//   node scripts/check-asar-integrity-fuse.mjs --self-test <path-to-binary>

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')

// Fuse wire v1 as of Electron 43. The INDEX is the load-bearing part: if a
// future Electron reorders or extends this list, checking index 4 would
// silently measure a different fuse — so we pin the version and the length and
// fail loudly on any change rather than trusting the offset. A red build that
// says "re-verify the index" is the correct outcome of an Electron upgrade.
const WIRE_VERSION = 1
const FUSE_COUNT = 9
const FUSE_NAMES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
  'ResetAspectRatioOnFullscreen'
]
const INTEGRITY_INDEX = FUSE_NAMES.indexOf('EnableEmbeddedAsarIntegrityValidation')

/** Locate the fuse wire and return its decoded state. Throws if unreadable. */
function readFuses(binaryPath) {
  const buf = readFileSync(binaryPath)
  const at = buf.indexOf(SENTINEL)
  if (at < 0) {
    throw new Error(
      `no Electron fuse sentinel in ${binaryPath} — not a packaged Electron ` +
        `binary, or the fuse format changed`
    )
  }
  const versionAt = at + SENTINEL.length
  const version = buf[versionAt]
  const count = buf[versionAt + 1]
  if (version !== WIRE_VERSION || count !== FUSE_COUNT) {
    throw new Error(
      `fuse wire is version ${version} with ${count} fuses; this script was ` +
        `written for version ${WIRE_VERSION} with ${FUSE_COUNT}. The fuse list ` +
        `may have been reordered — RE-VERIFY that index ${INTEGRITY_INDEX} is ` +
        `still EnableEmbeddedAsarIntegrityValidation before trusting this check.`
    )
  }
  const fusesAt = versionAt + 2
  const values = Array.from(buf.subarray(fusesAt, fusesAt + count), (b) =>
    String.fromCharCode(b)
  )
  return { offset: fusesAt, values }
}

function describe(values) {
  return values.map((v, i) => `  [${i}] ${FUSE_NAMES[i]} = ${v}`).join('\n')
}

/** True when integrity validation is ENFORCED (which would break ADR-0011). */
function integrityEnforced(values) {
  return values[INTEGRITY_INDEX] === '1'
}

/**
 * Prove the check is not vacuous.
 *
 * A checker that always reports "disabled" — wrong offset, wrong index, a typo
 * in the comparison — passes forever while the compliance guarantee rots. So
 * flip the fuse byte in a COPY and require the checker to notice. This is the
 * adversarial half the build plan calls for, kept in the script rather than the
 * workflow so it cannot be dropped by a later YAML edit.
 */
function selfTest(binaryPath) {
  const { offset, values } = readFuses(binaryPath)
  if (integrityEnforced(values)) {
    throw new Error('self-test needs a build with integrity DISABLED to mutate')
  }
  const mutant = join(tmpdir(), 'fuse-selftest-mutant.bin')
  const buf = readFileSync(binaryPath)
  buf[offset + INTEGRITY_INDEX] = '1'.charCodeAt(0)
  writeFileSync(mutant, buf)

  const mutated = readFuses(mutant)
  if (!integrityEnforced(mutated.values)) {
    throw new Error(
      'SELF-TEST FAILED: flipped the integrity fuse to enabled and the check ' +
        'still reported it disabled. The check is vacuous — it is not reading ' +
        'the fuse it claims to read.'
    )
  }
  console.log('self-test: flipping the fuse IS detected — the check has teeth')
}

const args = process.argv.slice(2)
const wantSelfTest = args[0] === '--self-test'
const target = wantSelfTest ? args[1] : args[0]

if (!target) {
  console.error('usage: check-asar-integrity-fuse.mjs [--self-test] <binary>')
  process.exit(2)
}

try {
  if (wantSelfTest) selfTest(target)

  const { values } = readFuses(target)
  console.log(`Electron fuses in ${target}:\n${describe(values)}`)

  if (integrityEnforced(values)) {
    console.error(
      '\nFAIL: EnableEmbeddedAsarIntegrityValidation is ENABLED.\n' +
        'ADR-0011 relies on it being off: with enforcement on, a recipient ' +
        'cannot substitute their own build of the LGPL occt-import-js library, ' +
        'and our published compliance claim becomes false.\n' +
        'Resolve deliberately — read ADR-0011 before changing either side.'
    )
    process.exit(1)
  }
  console.log('\nOK: ASAR integrity validation is not enforced (ADR-0011 holds).')
} catch (err) {
  console.error(`\nFAIL: ${err.message}`)
  process.exit(1)
}
