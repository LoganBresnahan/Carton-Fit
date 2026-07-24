// The single file importing STLLoader from three's jsm addons (ADR-0008's
// one-adapter-per-jsm-path rule, applied on the import-worker side — STL parsing
// lives in the worker, not the viewport). Path carries types via @types/three.
export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
