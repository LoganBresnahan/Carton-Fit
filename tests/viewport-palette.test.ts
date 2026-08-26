import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { viewportPalette } from '../src/renderer/src/viewport/palette'

// ADR-0025 §5: the viewport hand-copies colours out of the stylesheet, because
// a WebGL scene cannot read a CSS variable. The two-branch lookup is trivial;
// the COPY is the thing worth testing, so the second describe reads styles.css
// and asserts the two sets still agree — a light `--bg` re-picked without the
// palette following would otherwise show up only as a seam on screen.

describe('viewportPalette', () => {
  it('returns the dark set for dark and the light set for light', () => {
    expect(viewportPalette(true).background).toBe(0x1b1e24)
    expect(viewportPalette(true).part).toBe(0x9aa3b5)
    expect(viewportPalette(false).background).toBe(0xf4f6f9)
    expect(viewportPalette(false).part).toBe(0x5a6273)
  })

  it('shares no colour between the two schemes', () => {
    const dark = viewportPalette(true)
    const light = viewportPalette(false)
    for (const key of Object.keys(dark) as (keyof ReturnType<typeof viewportPalette>)[]) {
      expect(light[key], `--${key} is the same in both schemes`).not.toBe(dark[key])
    }
  })
})

/** The last definition of `--name` in a slice of the stylesheet: the bare
 *  `:root` block for the dark tokens, the `prefers-color-scheme: light` block
 *  for the light ones. */
function token(css: string, name: string, from: number, to: number): string {
  const found = [...css.slice(from, to).matchAll(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'gi'))]
  expect(found.length, `--${name} in this region of styles.css`).toBeGreaterThan(0)
  return found[found.length - 1][1].toLowerCase()
}

describe('the hand-copied tokens still match styles.css', () => {
  const css = readFileSync('src/renderer/src/styles.css', 'utf8')
  const lightBlock = css.indexOf('@media (prefers-color-scheme: light)')
  const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

  it('finds the light block at all', () => {
    expect(lightBlock).toBeGreaterThan(0)
  })

  it('mirrors --bg and --muted on the dark side', () => {
    expect(hex(viewportPalette(true).background)).toBe(token(css, 'bg', 0, lightBlock))
    expect(hex(viewportPalette(true).part)).toBe(token(css, 'muted', 0, lightBlock))
  })

  it('mirrors --bg and --muted on the light side', () => {
    expect(hex(viewportPalette(false).background)).toBe(token(css, 'bg', lightBlock, css.length))
    expect(hex(viewportPalette(false).part)).toBe(token(css, 'muted', lightBlock, css.length))
  })
})
