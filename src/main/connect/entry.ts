import { join } from 'node:path'
import { MCP_SERVER_KEY } from '../../shared/connect'

// The launch entry, client-neutral (ADR-0030 Decision 5) — and the two ways to
// say it out loud.
//
// ONE ENTRY, MANY SERIALISERS is the decision this file exists to enforce.
// Every client receives the same launch: `process.execPath`, the built shim,
// `--mcp`, the profile flag on a non-default profile, `ELECTRON_RUN_AS_NODE=1`.
// A client adapter *serialises* it — into `codex mcp add` argv, into JSON for
// Claude Desktop, into labelled fields for the manual fallback — and none
// composes one. A second place that decided what to launch would be a second
// place to get the Windows stdin finding wrong.
//
// Electron-free on purpose, like `mcp/pipePath.ts`: everything here is a pure
// derivation over strings, so the Windows shapes unit-test on Linux, which is
// the only machine our CI has.

/** One MCP server launch, in the shape Claude Desktop's config uses. */
export interface ServerEntry {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

/**
 * What the launch needs FROM THE SESSION — the variables a config cannot
 * invent, captured at write time.
 *
 * THE ENTRY MUST LAUNCH FROM AN EMPTY ENVIRONMENT. That is the invariant this
 * list exists to hold, and it was bought by a dogfood finding: ChatGPT (Codex)
 * listed Carton Fit as an enabled MCP server and advertised no tools at all.
 * OpenAI documents why — Codex hands a stdio child ONLY the variables the
 * entry declares (`env`) or names for forwarding (`env_vars`); it does not
 * pass the user's environment. Claude Desktop hides this by inheriting, so one
 * client's silence was covering the other's requirement.
 *
 * Reproduced before it was fixed: the shim launched with nothing but
 * `ELECTRON_RUN_AS_NODE=1` spawns an app that never starts, and after 20 s
 * exits 1 having written NOTHING to stdout — which is exactly what "listed,
 * no tools" looks like from the client's side. On Linux the minimum proved to
 * be `HOME` + `DISPLAY`; the rest of each platform's list is there for the
 * session shapes this machine is not (Wayland, a custom TMPDIR, Windows).
 *
 * TWO REASONS a variable belongs here, and both are load-bearing:
 *
 *   1. the app cannot START without it — `HOME` and `DISPLAY` on Linux,
 *      `SystemRoot` and the profile directories on Windows;
 *   2. the app and the shim must AGREE ON THE PIPE. `pipePath` reads
 *      `XDG_RUNTIME_DIR` (else the tmpdir, which reads `TMPDIR`/`TEMP`), and
 *      `defaultUserDataPath` reads `APPDATA`. A shim that lacks what a
 *      desktop-launched app has computes a different rendezvous, finds nobody
 *      listening, spawns a second instance that loses the single-instance race
 *      and exits — and then times out against a socket nobody will ever open.
 *      That failure is silent by construction, which is why the fix is to
 *      carry the variables rather than to detect the mismatch.
 *
 * Values, not names, because `env` is the one mechanism BOTH clients speak.
 * Codex also offers `env_vars` (forward-by-name, the "Environment variable
 * passthrough" box in its own form) and that would age better — a captured
 * value goes stale if the user's profile moves — but Claude Desktop has no
 * equivalent, and `codex mcp add`'s recorded grammar has `--env` and no flag
 * for `env_vars`. So: values today, and a revisit trigger in ADR-0030 for the
 * day the CLI grows the flag. The by-hand fallback DOES use the passthrough
 * box, because no person should retype eleven paths.
 */
export function sessionEnvKeys(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') {
    return [
      // Chromium's network and crypto init reach for these; a Windows process
      // without SystemRoot is not a process that finds System32.
      'SystemRoot',
      'SystemDrive',
      'windir',
      // The profile paths. APPDATA is also how the shim and the app agree on
      // the userData directory that names the pipe.
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
      'HOMEDRIVE',
      'HOMEPATH',
      'TEMP',
      'TMP',
      'PATH'
    ]
  }
  if (platform === 'darwin') return ['HOME', 'PATH', 'TMPDIR']
  return [
    'HOME',
    'PATH',
    // The display, in both protocols: an X session has DISPLAY, a Wayland one
    // may have only WAYLAND_DISPLAY, and a GUI app with neither cannot open a
    // window to be hidden.
    'DISPLAY',
    // And the KEY to that display. An X server that requires MIT-MAGIC-COOKIE
    // auth — which most session managers set up, and which `xvfb-run` does
    // unconditionally — refuses a client whose environment names no cookie
    // file, so DISPLAY without XAUTHORITY is a door without its key: the app
    // never opens a window, never listens on the pipe, and the shim spends its
    // whole 20-second deadline on a socket that will never exist. Absent here,
    // Xlib falls back to `~/.Xauthority`, which is why the gap survives on any
    // machine whose session leaves XAUTHORITY unset (WSLg, this dev box) and
    // shows up only where the cookie lives somewhere else (CI under xvfb).
    'XAUTHORITY',
    'WAYLAND_DISPLAY',
    'XDG_SESSION_TYPE',
    'DBUS_SESSION_BUS_ADDRESS',
    // Reason 2 above: these two decide where the socket lives.
    'XDG_RUNTIME_DIR',
    'TMPDIR'
  ]
}

/**
 * `PATH` is carried but NOT compared (see `sameEntry`).
 *
 * Alone among these it changes for reasons that have nothing to do with us —
 * any installer may append to it — and an entry that reported `outdated` every
 * time the user installed a program would train them to ignore the one state
 * that means something. Every other variable here is stable, and when one does
 * change it is genuinely stale: a `DISPLAY` from last session's login breaks
 * the launch, so flagging it is right and one Reconnect fixes it.
 */
const UNCOMPARED_ENV_KEYS: readonly string[] = ['PATH']

/** The variable that makes the shipped binary a plain Node process. */
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

/** The session's values for the keys above, skipping any it does not set. */
function sessionEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  const captured: Record<string, string> = {}
  for (const key of sessionEnvKeys(platform)) {
    const value = env[key]
    // An unset variable is not carried as an empty string: on Windows an empty
    // `TEMP` is worse than an absent one, and a key present-but-blank would
    // also make `sameEntry`'s presence check pass for an entry that is broken.
    if (value !== undefined && value !== '') captured[key] = value
  }
  return captured
}

/**
 * The entry that launches THIS build's shim.
 *
 * It is the `--mcp` invocation the e2e specs already drive (`e2e/mcpClient.ts`)
 * — deliberately, since a config describing a launch nothing has ever run is a
 * guess. One rule covers packaged and dev because `process.execPath` is the
 * Electron binary in both: shipped it is the installed app, in a checkout it is
 * `node_modules/electron`. What differs is only where `appPath` lands, and that
 * comes from the same `resolveAppRoot` derivation the two server modes use.
 *
 * `ELECTRON_RUN_AS_NODE` is the mechanism, not an accident (the footgun
 * CLAUDE.md warns the dev shell about, used on purpose): the shim must be a
 * plain Node process, because ADR-0029's Windows finding says a GUI-subsystem
 * Electron process never receives its stdin — a config pointing a client
 * straight at the app would hang forever on the primary target.
 *
 * The profile flag appears ONLY when this app is not on the default profile.
 * The pipe is named per-profile, so an app running on a throwaway `userData`
 * whose config omitted the flag would send the client to a universe with no app
 * in it — and a config for an ordinary install must stay free of
 * machine-specific paths it does not need.
 */
export function shimEntry(facts: {
  execPath: string
  appPath: string
  userData: string
  defaultUserData: string
  /** The session this entry is being written from — its platform decides which
   *  variables `sessionEnvKeys` carries, and its environment supplies them. */
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): ServerEntry {
  const args = [join(facts.appPath, 'out', 'main', 'mcp.js'), '--mcp']
  if (facts.userData !== facts.defaultUserData) args.push(`--user-data-dir=${facts.userData}`)
  return {
    command: facts.execPath,
    args,
    // ELECTRON_RUN_AS_NODE first and by hand: it is the mechanism, not part of
    // the session, and it is the one variable whose absence has already cost a
    // Windows dogfood cycle.
    env: { [RUN_AS_NODE]: '1', ...sessionEnv(facts.platform, facts.env) }
  }
}

/**
 * Is the entry a client is holding still this build's launch?
 *
 * Asymmetric on purpose, which the parameter names carry: `found` is whatever
 * that client's config has, `ours` is what this build would write. The command
 * and arguments must match exactly. The environment is judged by OURS: every
 * variable we would write has to be there and to agree — except `PATH`, which
 * is required to be present but not to match (see `UNCOMPARED_ENV_KEYS`).
 *
 * EXTRA VARIABLES IN `found` ARE FINE. Someone who added one by hand in their
 * client's own form had a reason, and reporting their entry as `outdated`
 * would offer to overwrite it every time the panel opens.
 *
 * The presence half is what upgrades an entry written by an older build: those
 * carry `ELECTRON_RUN_AS_NODE` and nothing else, which is the shape that
 * reaches ChatGPT as a server with no tools. Missing keys read as `outdated`,
 * the panel offers Reconnect, and one click writes the entry that works.
 */
export function sameEntry(found: ServerEntry, ours: ServerEntry): boolean {
  if (found.command !== ours.command) return false
  if (found.args.length !== ours.args.length) return false
  if (found.args.some((arg, i) => arg !== ours.args[i])) return false
  const foundEnv = found.env ?? {}
  const ourEnv = ours.env ?? {}
  return Object.keys(ourEnv).every((key) => {
    const value = foundEnv[key]
    if (value === undefined || value === '') return false
    return UNCOMPARED_ENV_KEYS.includes(key) || value === ourEnv[key]
  })
}

/**
 * The entry as arguments to `codex mcp add` (ADR-0030 Decision 2, mechanism 1).
 *
 * The grammar is the one probed on the requesting machine and recorded in the
 * ADR's Context: `add <name> [--env K=V]… -- <command> [args…]`. The `--` is
 * load-bearing and is why this is a builder rather than a template — without
 * it, an arg of ours that starts with a dash (`--mcp`, `--user-data-dir=`) is
 * Codex's flag to parse, not the server's.
 *
 * Returned as ARGV, not a string: this is what gets spawned, and a spawn with
 * an argument vector has no quoting problem to get wrong. Quoting enters only
 * where a human has to retype it — see `quotedCommandLine`.
 */
export function codexAddArgv(entry: ServerEntry, key: string = MCP_SERVER_KEY): string[] {
  const env = Object.entries(entry.env ?? {}).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`
  ])
  return ['mcp', 'add', key, ...env, '--', entry.command, ...entry.args]
}

/**
 * The entry as fields a person retypes into a client's own "add a server" form
 * (ADR-0030 Decision 2, mechanism 3 — revised 2026-09-02, see the ADR's second
 * addendum).
 *
 * ONE FIELD PER BOX, and that is the whole reason this is not a string. Codex's
 * form — Settings → Plugins → MCPs → Add → "Connect to a custom MCP" — takes
 * the command in one box and then EACH ARGUMENT IN ITS OWN, added a row at a
 * time, with environment variables as separate Key and Value inputs. A pasteable
 * command line is the wrong artifact for that form: the user would have to split
 * it by hand, at exactly the moment they are already stuck, and the paths in it
 * contain the spaces that make splitting it by hand go wrong.
 *
 * The labels are the client's own words, not ours. Someone copying a value is
 * looking at their screen and at ours, and a mismatch in wording is a reason to
 * doubt they are in the right place.
 */
export function codexManualFields(
  entry: ServerEntry,
  key: string = MCP_SERVER_KEY
): { label: string; value: string }[] {
  // The session variables go in as NAMES, in Codex's "Environment variable
  // passthrough" box, not as eleven Key/Value pairs. Both routes end in the
  // same launch — forwarded by name, or written by value as `connect()` does —
  // and this is the one place the difference is worth having: nobody is
  // retyping their own PATH into a form by hand, and a forwarded name cannot
  // go stale the way a copied value can.
  const passthrough = Object.keys(entry.env ?? {}).filter((name) => name !== RUN_AS_NODE)
  return [
    { label: 'Name', value: key },
    { label: 'Type', value: 'STDIO' },
    { label: 'Command to launch', value: entry.command },
    ...entry.args.map((arg, i) => ({ label: `Argument ${i + 1}`, value: arg })),
    // Set, not forwarded: this one is the mechanism (a plain-Node launch), and
    // the user's own environment has no such variable to pass through.
    ...(entry.env?.[RUN_AS_NODE] === undefined
      ? []
      : [{ label: `Environment variable — ${RUN_AS_NODE}`, value: entry.env[RUN_AS_NODE] }]),
    ...(passthrough.length === 0
      ? []
      : [{ label: 'Environment variable passthrough', value: passthrough.join(', ') }])
  ]
}
