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
arrived with a dependency tree of 61 further packages, 26 MB, of which a
server speaking MCP over stdio loads a handful — the rest is an HTTP transport
stack (express, hono, jose) this application never opens. Since the pruning
this table's earlier revision promised (roadmap item 21, phase 3), **none of
that tree ships as packages**: the SDK is bundled into the application's own
main-process code by the build, exactly as react and three are bundled into
the renderer, and rollup takes only what the stdio server reaches. What
survives is the SDK itself plus the six packages below — and because their
code ships inside our bundle where no `LICENSE` file sits beside it, their
full licence texts are carried **in this file** (see "Notices carried in this
file"), which itself ships in the application root. The build writes the
authoritative list of bundled packages to `out/main/bundled-modules.json`, and
a test fails if that list ever names a package this file does not.

| Component | Version | Licence | Source |
| --- | --- | --- | --- |
| `ajv` | 8.20.0 | MIT | https://github.com/ajv-validator/ajv |
| `ajv-formats` | 3.0.1 | MIT | https://github.com/ajv-validator/ajv-formats |
| `fast-deep-equal` | 3.1.3 | MIT | https://github.com/epoberezkin/fast-deep-equal |
| `fast-uri` | 3.1.5 | BSD-3-Clause | https://github.com/fastify/fast-uri |
| `json-schema-traverse` | 1.0.0 | MIT | https://github.com/epoberezkin/json-schema-traverse |
| `zod-to-json-schema` | 3.25.2 | ISC | https://github.com/StefanTerdell/zod-to-json-schema |

> The MIT License grants permission free of charge to any person obtaining a
> copy of the software to deal in it without restriction, provided the above
> copyright notice and this permission notice are included in all copies or
> substantial portions of the software. Each component's full notice ships
> inside the application: beside the package in the archive, or — for code
> bundled without its package — verbatim in the section below.

Build-time-only tooling (TypeScript, Vite, electron-vite, electron-builder,
vitest, Playwright — MIT and Apache-2.0) does not form part of the distributed
binary and is therefore not listed.

---

## Notices carried in this file

The packages here ship as code bundled into the application's own files, so
their licence texts cannot ride beside them as `LICENSE` files the way the
node_modules packages' do. The texts below are reproduced verbatim from each
package as published; this file ships in the application root, which is what
keeps the obligation met. `e2e/licence-notices.spec.ts` accepts a component as
compliant only if its notice is found in the archive **or** in this section —
removing either fails the suite.

### Notice: `@modelcontextprotocol/sdk`

```
MIT License

Copyright (c) 2024 Anthropic, PBC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Notice: `ajv`

```
The MIT License (MIT)

Copyright (c) 2015-2021 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

### Notice: `ajv-formats`

```
MIT License

Copyright (c) 2020 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Notice: `fast-deep-equal`

```
MIT License

Copyright (c) 2017 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Notice: `fast-uri`

```
Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/garycourt/uri-js/graphs/contributors```

### Notice: `json-schema-traverse`

```
MIT License

Copyright (c) 2017 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Notice: `zod-to-json-schema`

```
ISC License

Copyright (c) 2020, Stefan Terdell

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.```

---

## Keeping this file true

It is a distribution obligation, not documentation: a dependency added to the
shipped bundle without a line here makes the release non-compliant. `/shipshape`
checks it, and adding any runtime dependency already requires an ADR — updating
this file is part of that.
