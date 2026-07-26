// The packed-view capture seam (ADR-0017 §1).
//
// The viewport owns an imperative three.js lifecycle in a closure (ADR-0008),
// so nothing outside it can reach the renderer or the canvas. Rather than
// hoisting that state — which would undo the ADR — the island REGISTERS a
// capture function while it is mounted, and the export button calls it. Three
// stays entirely inside the viewport; the export module imports only this file.
//
// WHY IT MUST RENDER FIRST: a WebGL drawing buffer is cleared once the frame is
// composited, so `toDataURL` on a canvas that rendered earlier returns a blank
// image. The usual fix is `preserveDrawingBuffer: true`, which taxes every
// frame for the life of the app to serve a rare click. Rendering and reading
// back inside one synchronous call costs the same nothing the rest of the time,
// because control never returns to the compositor in between.

/** Renders the current scene and returns a `data:image/png;base64,…` URL. */
export type ViewportCapture = () => string

let capture: ViewportCapture | null = null

/** Called by the viewport on mount, and with null on teardown. */
export function registerViewportCapture(fn: ViewportCapture | null): void {
  capture = fn
}

/**
 * Capture the packed view, or null when there is nothing to capture — no
 * viewport mounted, GL unavailable, or the read-back failed.
 *
 * Never throws: a failed capture must leave the button reporting a failure, not
 * take down the results panel around it.
 */
export function captureViewportPng(): string | null {
  if (!capture) return null
  try {
    const url = capture()
    return url.startsWith('data:image/png') ? url : null
  } catch {
    return null
  }
}

/** The base64 payload of a data URL, for the export IPC. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? '' : dataUrl.slice(comma + 1)
}
