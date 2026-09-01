import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './harness'

// THIRD-PARTY-NOTICES.md, read the way the licence guards read it — from the
// file itself rather than from lists restated in specs, so a package added to
// the notices starts being checked without anyone remembering to update a
// test (the same rule licence-notices.spec.ts has kept since roadmap item 14).

export function noticesText(): string {
  return readFileSync(join(REPO_ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
}

/** Every component the notices file cites: the package name in the first
 *  column of any `| \`name\` | …` table row, plus any package given a section
 *  of its own (`## name — <licence>`, the form occt-import-js's LGPL section
 *  uses — a single token before the em dash, so prose headings don't match). */
export function citedPackages(notices: string = noticesText()): string[] {
  const names = notices
    .split('\n')
    .map(
      (line) =>
        /^\|\s*`([^`]+)`/.exec(line)?.[1]?.trim() ?? /^## (\S+) — /.exec(line)?.[1]?.trim()
    )
    .filter((name): name is string => name !== undefined)
  if (names.length === 0) throw new Error('parsed no components out of THIRD-PARTY-NOTICES.md')
  return names
}

/**
 * The full licence text carried inline for a bundled-only package, or null.
 *
 * A package whose code ships bundled inside our own files (the MCP SDK and its
 * runtime subset — ADR-0029 phase 3) has no node_modules directory in the
 * archive to carry its LICENSE, so the notices file itself carries the text
 * under a `### Notice: \`name\`` heading. Structural on purpose: a prose
 * mention of the package name must not satisfy a licence check.
 */
export function inlineNotice(name: string, notices: string = noticesText()): string | null {
  const lines = notices.split('\n')
  const heading = lines.findIndex((line) => line.trim() === `### Notice: \`${name}\``)
  if (heading === -1) return null
  const rest = lines.slice(heading + 1)
  const next = rest.findIndex((line) => line.startsWith('### ') || line.startsWith('## '))
  return (next === -1 ? rest : rest.slice(0, next)).join('\n')
}
