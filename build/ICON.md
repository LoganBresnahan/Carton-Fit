# App icon

`icon.png` — 512×512 RGBA, the app icon electron-builder turns into the Windows
`.ico` and the Linux desktop icon. `icon-source.png` is the unmodified source
art it was derived from, kept so the derivation can be redone or revised.

## What was done to the source, and why

The source is a 1024×1024 generated image of a cyan neon wireframe cube. Three
things made it unusable as-is:

1. **It was not transparent.** Every pixel was alpha 255. The familiar grey
   checkerboard was *painted into the artwork* — a picture of transparency
   rather than the real thing. Shipped as-is, the taskbar icon would have been a
   cube sitting on a grey checkerboard.
2. **A generator watermark** (a small sparkle) sat in the bottom-right corner.
3. **The cube filled only ~63% of the canvas**, so it would have rendered
   noticeably smaller than neighbouring taskbar icons.

The checkerboard was removed by treating it as what it is: a known periodic
signal composited *under* the artwork, `O = a·F + (1-a)·B`. Fitting `B` as a
box-sampled square wave (period 40.965 px — not an integer, which is why a
fixed-grid tile smears) and regressing the observed image against it over a
window spanning a full period recovers `(1-a)` without needing to know `F`. Two
details did the heavy lifting: a hard arithmetic bound `a ≥ (O-B)/(255-B)`,
which no colour channel can violate, keeps the thin neon lines crisp where a
wide regression window would have averaged them into their own halo; and the
smooth interior fill is reconstructed from a smoothed estimate, because the
source is heavily compressed (its nominal 97 grey ranges 70–139) and dividing
that noise by a small alpha is what produced checker-shaped mottling.

Then: watermark zeroed, cropped to the artwork's alpha bounds (652×652 of the
original 1024²), downscaled to 512 with a premultiplied box filter.

Output was checked composited over both dark and white backgrounds and at 256,
128, 64, 48, 32 and 16 px. It reads as a cube down to 32 px; at 16 px it is a
glowing blob, which is inherent to the artwork rather than to the processing.

## If the icon needs regenerating

The processing was a one-off script, not committed — it exists to serve this
one image and would be dead code in `scripts/`. `icon-source.png` plus the
description above is what makes it reproducible. If a **clean** source ever
turns up (real transparency, no watermark), prefer it outright: everything above
is recovery work that a proper export makes unnecessary.
