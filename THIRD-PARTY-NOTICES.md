# Third-party notices

Carton Fit is distributed under the MIT License (see `LICENSE`). The
binary you run also contains the third-party components listed here, each under
its own licence. Nothing below is modified from its published form.

This file is shipped inside the application, next to `LICENSE.electron.txt`.

---

## occt-import-js — LGPL-2.1  ⚠️ read this one

| | |
| --- | --- |
| Version | 0.0.23 |
| Licence | GNU Lesser General Public License, version 2.1 |
| Source | https://github.com/kovacsv/occt-import-js |
| Upstream | Open CASCADE Technology — https://git.dev.opencascade.org/repos/occt.git |
| Modified by us? | **No.** Used exactly as published on npm. |
| Where it lives | `resources/app.asar.unpacked/out/renderer/assets/occt-import-js-<hash>.wasm` |
| How many copies ship | **One.** Both the 3D view and the AI-client interface load that file. |

occt-import-js is the OpenCascade STEP/IGES kernel compiled to WebAssembly. It
is the only component here that is not permissively licensed. The bundled
licence text is **plain LGPL-2.1** — it carries no Open CASCADE Exception — so
the obligation a licence list alone does not satisfy applies in full: **you must
be able to replace the library with your own build.**

That right is honoured concretely rather than on paper:

1. The `.wasm` is **not** inlined into a JavaScript bundle. It is emitted as a
   standalone file and loaded at runtime through Emscripten's `locateFile`
   (`src/renderer/src/workers/occt/loadOcct.ts`).
2. It is deliberately **excluded from the `app.asar` archive** (`asarUnpack` in
   `electron-builder.yml`), so it sits on disk as an ordinary file rather than
   inside a container you would have to repack.

**To substitute your own build:** compile occt-import-js from the source above,
then overwrite the `.wasm` file at the path in the table — keeping the existing
filename, which is content-hashed and referenced by the bundle. No repacking, no
rebuild of this application, no tooling beyond a file copy. The application
loads whichever binary is at that path on next launch.

That is a tested claim, not an intended one: replacing the file with a
deliberately invalid one makes the packaged application fail to import STEP,
which is how we confirmed the shipped binary reads that path and no embedded
copy. Verified on Linux; re-verify on Windows when CI starts producing the
installer.

Since ADR-0029 the application reads STEP files from a second place — the
main process, for the MCP interface Claude talks to — and **that path was made
to load the same single file rather than a private copy of its own.** A second
copy would have been the easy build (the library is an npm package; nothing
stops a `require`), and it would have made the paragraph above false in the
worst way: a recipient could substitute their build, watch the 3D view honour
it, and never learn that the other half of the app went on running the
original. The same corruption test proves this path too — invalidate that one
file and main-process STEP import fails with it (verified 2026-09-01 on the
packaged Linux build, 18-solid AS1 golden).

> **Do not enable ASAR integrity enforcement without revisiting this.** The
> archive header records a SHA-256 for the unpacked `.wasm`; if enforcement is
> ever switched on, a substituted library would be rejected at load and the
> guarantee above would silently become false.

The complete LGPL-2.1 text ships inside the application archive, at
`node_modules/occt-import-js/LICENSE.md` and
`node_modules/occt-import-js/dist/license.occt.txt`, and is also at
https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html

---

## Electron and Chromium

| | |
| --- | --- |
| Version | Electron 43.2.0 |
| Licence | MIT (Electron); Chromium and its dependencies carry their own |
| Source | https://github.com/electron/electron |

Electron ships its own licence files in the application root:
`LICENSE.electron.txt` and `LICENSES.chromium.html`. The latter is the
authoritative list for everything inside the Chromium runtime and is not
reproduced here.

One component inside that runtime is worth calling out for the same reason as
occt-import-js: **FFmpeg is LGPL-licensed**, and Chromium links it as a shared
library (`libffmpeg.so` on Linux, `ffmpeg.dll` on Windows) specifically so it
can be replaced. It ships as a discrete file for exactly that purpose.

---

## Bundled into the application code — all permissive

These are compiled into the renderer bundle. All are MIT; each permits use and
redistribution provided its copyright notice and permission notice are retained,
which this file does.

Package names are given exactly as published, so this table can be checked
mechanically against `package.json` (`/shipshape` does).

| Component | Version | Licence | Source |
| --- | --- | --- | --- |
| `react` | 19.2.8 | MIT | https://github.com/facebook/react |
| `react-dom` | 19.2.8 | MIT | https://github.com/facebook/react |
| `three` (three.js) | 0.185.1 | MIT | https://github.com/mrdoob/three.js |
| `zustand` | 5.0.14 | MIT | https://github.com/pmndrs/zustand |
| `better-sqlite3` | 12.11.1 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| `zod` | 4.5.4 | MIT | https://github.com/colinhacks/zod |

`better-sqlite3` is a native module: it ships as a compiled `.node` binary outside
`app.asar` rather than bundled into the JavaScript, and it embeds
[SQLite](https://sqlite.org), which is in the **public domain**.

`zod` is listed on its own line rather than folded into the SDK's tree because
we import it directly: it is the language the MCP tool schemas are written in
(`src/main/mcp/schemas.ts`), and those schemas are what make a dropped
qualification a failed call rather than a confident answer. It arrived with the
SDK either way — declaring it is honesty about what the code reaches for, which
is what ADR-0011's rule is for.

`@modelcontextprotocol/sdk` (ADR-0029 — it is what Claude Desktop talks to)
arrived with a dependency tree of 61 further packages, and **all of them ship
today**, because electron-builder includes production dependencies whether or
not the application reaches them. Every one is permissively licensed — MIT but
for `json-schema-typed` (BSD-2-Clause), `qs` (BSD-3-Clause), and `setprototypeof`
and `zod-to-json-schema` (ISC) — and every one carries its own `LICENSE` inside
the archive, which is what the closing paragraph of this section asserts. That
was checked against the packaged build's own archive index rather than assumed:
61 directories, 61 licence texts, none empty (2026-09-01). They
are not listed individually because most of them are not meant to be here: a
server speaking MCP over stdio loads 8 of the 62, and the rest are an HTTP
stack (express, hono, jose) for transports this application does not use.
Pruning them is on the roadmap under item 21, at the slice that first imports
the SDK; this table gets whatever survives that.

> The MIT License grants permission free of charge to any person obtaining a
> copy of the software to deal in it without restriction, provided the above
> copyright notice and this permission notice are included in all copies or
> substantial portions of the software. Each component's full notice ships with
> it inside the application archive.

Build-time-only tooling (TypeScript, Vite, electron-vite, electron-builder,
vitest, Playwright — MIT and Apache-2.0) does not form part of the distributed
binary and is therefore not listed.

---

## Keeping this file true

It is a distribution obligation, not documentation: a dependency added to the
shipped bundle without a line here makes the release non-compliant. `/shipshape`
checks it, and adding any runtime dependency already requires an ADR — updating
this file is part of that.
