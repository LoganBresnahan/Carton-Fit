# ADR-0001: Electron as the desktop shell

Date: 2026-07-24
Status: Accepted

## Context

The app must install like normal downloadable software — Windows first, all three OSs
desirable — and its core workload is a WebGL 3D viewport (three.js) plus a WASM STEP
parser. The shell choice determines the installer story, the rendering engine, and how
much per-OS testing the 3D view needs.

## Decision

Build on **Electron** (electron-vite layout, React + TypeScript renderer), with
**electron-builder** producing installers: Windows NSIS `Setup.exe` (primary), macOS
dmg, Linux AppImage.

## Consequences

- One bundled Chromium everywhere: the WebGL viewport and WASM parser run on a single
  known engine — no per-OS webview differences to test.
- Windows NSIS installers cross-build routinely from Linux/WSL, our dev environment.
- Cost: ~80–100 MB installer and Chromium-sized RAM footprint; acceptable for an
  engineering utility.
- The renderer (viewport, parser, packing engine — ~90% of the app) is plain web tech,
  so a later shell swap stays cheap.

## Alternatives considered

- **Tauri** — ~10 MB installers via OS webviews. Rejected for v1: per-OS webview
  differences are the exact risk a WebGL-heavy app doesn't want (WebKitGTK on Linux
  especially), the Rust backend advantage is wasted (heavy lifting is already WASM in
  the webview), and Windows cross-builds from WSL are fiddlier. Pressure-tested twice
  with the user before settling.
- **Python + Qt (pythonocc)** — rejected: bundling OpenCascade + Qt + Python into a
  clean Windows installer is the painful part, the opposite of "download and run".

## Revisit triggers

- Download size becomes a real distribution problem (emailed installers, strict IT
  limits) → re-evaluate Tauri; only the thin shell needs rewriting.
- Tauri's Linux/macOS WebGL story matures and per-OS testing cost drops.
- A need for native-speed backend compute emerges (e.g. tier-3 nesting in Rust).
