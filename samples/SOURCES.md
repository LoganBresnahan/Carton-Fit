# Golden sample provenance

| File | Source | Why it's here |
| --- | --- | --- |
| `as1-oc-214.stp` | CAx-IF STEP interoperability test library (https://www.cax-if.org/cax/cax_stepLib.php), via the occt-import-js test suite | Nested, *instanced* assembly (AS1: plate + two identical l-bracket sub-assemblies + rod). Guards the ADR-0002 addendum: occt-import-js must keep emitting per-instance meshes with world-space-baked transforms. |
| `cube-10x10.stp` | occt-import-js test suite (`cube-10x10mm/Cube 10x10.stp`) | Simple-part golden. Hand-computed: 10 mm cube → 1000 mm³, 10×10×10 bbox, 1 part. The anti-tautology fixture for `golden-parse.test.ts`. |
| `cube-10x10.stl` | occt-import-js test suite (`cube-10x10mm/Cube 10x10.stl`) | Same cube as binary STL. Golden for the STL path (same 1000 mm³ / 10³ goldens) and proof the position-welded closed-mesh check handles STLLoader's fully-duplicated vertices. |
