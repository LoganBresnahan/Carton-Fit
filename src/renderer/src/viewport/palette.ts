// The viewport's colours (ADR-0025 §5).
//
// A WebGL scene cannot read a CSS custom property, so these four values are
// hand-copied from `styles.css` and the comment beside each names the token it
// mirrors. That copy is the whole reason this file exists as a lookup rather
// than four constants scattered across three modules: one place to keep in
// step, and one place for the e2e clear-colour spec to catch a drift in.
//
// Pure (no three, no DOM, no store) — the island calls it and the builders take
// the `dark` boolean it keys on, so ADR-0008's "no three outside the viewport"
// is untouched: there is no three here to leak.

export interface ViewportPalette {
  /** Scene background — the renderer's clear colour. Mirrors `--bg`, so the
   *  canvas and the app around it are one surface. It is also what the PNG
   *  export captures (ADR-0017), which is why a light-theme quote comes out on
   *  white rather than as a dark rectangle on the page. */
  readonly background: number
  /** The parts themselves: neutral steel, mirroring `--muted`. */
  readonly part: number
  /** The carton wireframe — the one value with no token of its own. The carton
   *  has to read against the background at both ends, so it is picked for
   *  contrast (≈4.3:1 either way) rather than copied from anything. */
  readonly cartonLine: number
  /** The hemisphere light's ground colour: the bounce from below, which keeps a
   *  part's underside from going flat black on the dark side and from losing
   *  its form against the background on the light one. */
  readonly ground: number
}

/** Unchanged from what shipped — the dark side is the app as it looks today. */
const DARK: ViewportPalette = {
  background: 0x1b1e24, // --bg
  part: 0x9aa3b5, // --muted
  cartonLine: 0x7c88a0,
  ground: 0x333844 // a shade deeper than --border (#3a4050)
}

const LIGHT: ViewportPalette = {
  background: 0xf4f6f9, // --bg     (light)
  part: 0x5a6273, // --muted  (light)
  cartonLine: 0x6b7488,
  ground: 0xd3d9e3 // --border (light)
}

/** The palette for a RESOLVED scheme. `dark` comes from `prefers-color-scheme`
 *  in the island, never from the preference — which may be `system`, and so is
 *  not a colour at all. */
export function viewportPalette(dark: boolean): ViewportPalette {
  return dark ? DARK : LIGHT
}
