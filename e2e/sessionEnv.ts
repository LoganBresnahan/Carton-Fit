import { expect } from '@playwright/test'
import { sessionEnvKeys } from '../src/main/connect/entry'

/**
 * The entry carries this session's own variables (ADR-0030 addendum 3).
 *
 * PER PLATFORM, from the same list the app writes from — never a variable
 * named in a spec. The first version of this assertion pinned `HOME` and went
 * red on windows-latest, where the runner has a `HOME` and the entry correctly
 * carries `USERPROFILE`, `APPDATA` and `SystemRoot` instead. Naming one
 * platform's variables in a test tests that platform; asking the list tests
 * the rule, on whichever machine happens to be running.
 *
 * Values, not just keys: a captured variable that arrived empty or altered
 * would launch an app somewhere other than where the user's is.
 */
export function expectCarriesSession(env: Record<string, string> | undefined): void {
  const expected = sessionEnvKeys(process.platform).filter(
    (key) => process.env[key] !== undefined && process.env[key] !== ''
  )
  // Every platform's list has something a running session sets; an empty
  // intersection means the list is wrong, not that there is nothing to check.
  expect(expected.length).toBeGreaterThan(0)
  for (const key of expected) expect(env?.[key], `entry is missing ${key}`).toBe(process.env[key])
}
