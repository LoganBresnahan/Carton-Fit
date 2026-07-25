# App icon

`icon.png` — 512×512 RGBA, the app icon electron-builder turns into the Windows
`.ico` and the Linux desktop icon. `icon-source.png` is the unmodified source
art it was cut from, kept so the derivation can be redone or revised.

## The design

A rounded-rect tile: cyan neon wireframe cube on a dark blue gradient, with a
light blue border stroke. The tile is the point — it carries its own background,
so the icon has the same contrast on a dark taskbar and in a light-theme file
list. Two earlier versions of the artwork were background-less glowing cubes,
and the second one was rejected for exactly this: a white glow is invisible
against white.

## What was done to the source, and why

The source is 1024×1024 and **fully opaque** — the familiar grey checkerboard is
painted into the picture rather than being real transparency (both previous
sources had the same problem). The tile occupies the middle ~700 px, and a
generator watermark sits in the bottom-right corner outside it.

Rather than recovering a mask from where the tile meets the checkerboard — which
smears grey along the curves — the mask is **synthesized from the geometry**:

- Tile bounds measured at **696×696 at (164,164)**, corner radius fitted to
  **120.5 px** (0.68 px RMS across the corner profile, with all four corners
  agreeing to within a pixel).
- Coverage is computed from a rounded-rect signed-distance function, 4×4
  supersampled, then the whole thing is downscaled 696→512 in premultiplied
  space. Analytic curves beat extracted ones here: at 32 px a fuzzy corner reads
  as mush.

Finding the true edge was the one subtlety. A colour-saturation test alone put
the boundary out at the tile's **drop shadow**, which let the checkerboard into
the rounded edge as a visible dotted fringe. The border stroke is bright *and*
blue; the checkerboard's light squares are equally bright but perfectly neutral,
and the shadow is blue-ish but dark — only the stroke is both, and testing for
both fixes the rect. The drop shadow is deliberately excluded: the OS draws its
own shadows, and a baked-in one looks wrong everywhere.

The watermark needs no handling — it falls outside the crop.

Checked composited over dark and white at 256, 128, 64, 48 and 32 px. The cube
still reads at 32 px, and the tile makes the two backgrounds identical.

## If the icon needs regenerating

The processing was a one-off script, not committed — it serves this one image
and would be dead code in `scripts/`. `icon-source.png` plus the measurements
above is what makes it reproducible. A source exported with **real transparency
and no watermark** would make all of this unnecessary; prefer that if one ever
turns up.
