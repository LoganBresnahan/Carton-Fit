#!/usr/bin/env node
'use strict'

// A fake `codex` CLI (ADR-0030 Decision 7, slice `fake-codex-cli-e2e`).
//
// WHAT THIS IS FOR. The Codex adapter's job is to build an argument vector,
// spawn another company's program with it, and read what comes back. Only one
// of those three is testable against the real thing on our machines — no CI
// runner has Codex, and the requesting machine is Windows. So this script
// stands in for `codex.exe` at the `CODEX_CLI` seam and lets the Linux suite
// pin OUR half end to end: the argv `codexAddArgv` builds, the `--json` shape
// `parseCodexGet` reads, and every panel state that follows from them.
//
// WHAT IT IS NOT. It is not a model of Codex. It implements the `mcp`
// subcommands AS OBSERVED on `codex-cli 0.152.1` and recorded in ADR-0030's
// Context — nothing else, and nothing invented. Its green says the adapter
// agrees with that recording; it says nothing at all about whether the
// recording still matches OpenAI's tool. That question belongs to
// `codex-real-cli.spec.ts` and to dogfooding, and the ADR says so in the same
// breath as it asks for this file.
//
// The recorded contract, in full:
//   add <name> [--env K=V]… -- <command> [args…]   0, and a re-add of the same
//                                                  name REPLACES in place
//   get <name> [--json]                            {transport:{command,args,env},
//                                                  enabled, …}
//   get <unknown>                                  exit 1, "No MCP server named
//                                                  '…' found." on stderr
//   list [--json]                                  every server
//   remove <name>                                  0; unknown exits 1 as above
//
// THE STORE IS THE TEST'S WINDOW. `$CODEX_HOME/servers.json` stands in for
// `config.toml` — a JSON object keyed by server name, because the whole point
// of ADR-0030 Decision 3 is that nothing in this repo owns a TOML parser, and
// a fake that grew one would be modelling the wrong thing. A spec seeds it to
// choose the state the adapter finds, and reads it back to see what the adapter
// wrote. Two fields exist only for the spec's benefit and are marked where they
// are set: `rawArgv` and `garbled`.

const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const home = process.env.CODEX_HOME
if (!home) {
  // Never guess `~/.codex`. A fake that fell back to the real home would write
  // into a dogfooder's actual Codex config the first time a spec forgot the
  // variable — the one thing e2e must never touch.
  process.stderr.write('fake codex: CODEX_HOME is not set\n')
  process.exit(3)
}
const storePath = join(home, 'servers.json')

function load() {
  try {
    return JSON.parse(readFileSync(storePath, 'utf8'))
  } catch {
    return {}
  }
}

function save(servers) {
  mkdirSync(home, { recursive: true })
  writeFileSync(storePath, `${JSON.stringify(servers, null, 2)}\n`, 'utf8')
}

function missing(name) {
  // Byte-for-byte the sentence the real CLI prints, because the adapter's
  // treatment of it — exit 1 is DATA, the ordinary not-connected case — is the
  // behaviour under test.
  process.stderr.write(`No MCP server named '${name}' found.\n`)
  process.exit(1)
}

function add(argv, rawArgv) {
  // The knob, and the reason it is an env var rather than a store field: this
  // is the case where the CLI fails BEFORE writing anything, so there is no
  // store state that could express it. Specs set it around `launchApp` and
  // delete it immediately — the harness copies `process.env` into the child,
  // so a leaked knob would make every later spec's Connect button fail.
  const forced = process.env.FAKE_CODEX_ADD_EXIT
  if (forced !== undefined && forced !== '') {
    process.stderr.write('fake codex: refusing to add (FAKE_CODEX_ADD_EXIT)\n')
    process.exit(Number(forced))
  }

  const name = argv.shift()
  if (name === undefined) {
    process.stderr.write('fake codex: add needs a name\n')
    process.exit(2)
  }
  const env = {}
  while (argv[0] === '--env') {
    argv.shift()
    const pair = argv.shift() ?? ''
    const eq = pair.indexOf('=')
    // Split on the FIRST '=' only: a value may contain one, and a path may
    // contain almost anything.
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  if (argv[0] !== '--') {
    // The `--` is load-bearing — without it our own `--mcp` and
    // `--user-data-dir=` would be Codex's flags to parse rather than the
    // server's. A fake that shrugged this off would let the adapter drop the
    // separator and stay green.
    process.stderr.write(`fake codex: expected -- before the command, got ${argv[0] ?? '(end)'}\n`)
    process.exit(2)
  }
  argv.shift()
  const command = argv.shift()
  if (command === undefined) {
    process.stderr.write('fake codex: add needs a command\n')
    process.exit(2)
  }

  const servers = load()
  // REPLACE IN PLACE, keyed by name — the probed idempotence that lets the
  // adapter re-add instead of remove-then-add. `enabled` is not carried over: a
  // fresh `add` is a fresh entry, and a spec that wants a disabled one seeds it.
  servers[name] = {
    command,
    args: argv,
    env,
    enabled: true,
    // For the spec, and the reason this fake exists rather than a constant in a
    // test: what is asserted is the argv the ADAPTER BUILT, not one re-derived
    // by the assertion from the same source it is meant to check.
    rawArgv
  }
  save(servers)
  process.stdout.write(`Added MCP server '${name}'.\n`)
}

function get(argv) {
  const name = argv.shift()
  const wantsJson = argv.includes('--json')
  const server = load()[name]
  if (server === undefined) missing(name)
  if (!wantsJson) {
    process.stdout.write(`${name}: ${server.command} ${(server.args ?? []).join(' ')}\n`)
    return
  }
  // Seeded by a spec that wants the "answered in a format we do not recognise"
  // path: printed verbatim, so the adapter meets exactly the bytes the spec
  // chose. Nothing the real CLI does — the state it stands for is a future
  // version of the real CLI whose shape moved.
  if (typeof server.garbled === 'string') {
    process.stdout.write(server.garbled)
    return
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        name,
        // The extra keys are the recorded shape's "…" — present so the
        // adapter's shape check is exercised against a superset, which is what
        // it will always meet in the field.
        enabled: server.enabled !== false,
        startup_timeout_sec: 10,
        tool_timeout_sec: 60,
        transport: { type: 'stdio', command: server.command, args: server.args ?? [], env: server.env ?? {} }
      },
      null,
      2
    )}\n`
  )
}

function list(argv) {
  const servers = load()
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(servers, null, 2)}\n`)
    return
  }
  for (const name of Object.keys(servers)) process.stdout.write(`${name}\n`)
}

function remove(argv) {
  const name = argv.shift()
  const servers = load()
  if (servers[name] === undefined) missing(name)
  delete servers[name]
  save(servers)
  process.stdout.write(`Removed MCP server '${name}'.\n`)
}

const argv = process.argv.slice(2)
if (argv.shift() !== 'mcp') {
  process.stderr.write('fake codex: only the `mcp` subcommand exists here\n')
  process.exit(2)
}
const sub = argv.shift()
if (sub === 'add') add(argv, process.argv.slice(2))
else if (sub === 'get') get(argv)
else if (sub === 'list') list(argv)
else if (sub === 'remove') remove(argv)
else {
  process.stderr.write(`fake codex: unknown subcommand ${sub ?? '(none)'}\n`)
  process.exit(2)
}
