// The single file that imports OrbitControls from three's jsm addons (ADR-0008:
// one adapter module per jsm path, so a path change on a three upgrade touches
// exactly one file). Import via `three/examples/jsm/...` — three's exports map
// also aliases `three/addons/*`, but @types/three ships the .d.ts only under
// examples/jsm, so this is the path that carries types.
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
