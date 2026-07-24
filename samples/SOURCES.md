# Golden sample provenance

| File | Source | Why it's here |
| --- | --- | --- |
| `as1-oc-214.stp` | CAx-IF STEP interoperability test library (https://www.cax-if.org/cax/cax_stepLib.php), via the occt-import-js test suite | Nested, *instanced* assembly (AS1: plate + two identical l-bracket sub-assemblies + rod). Guards the ADR-0002 addendum: occt-import-js must keep emitting per-instance meshes with world-space-baked transforms. |
