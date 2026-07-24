// Ambient types for occt-import-js (0.0.23) — the package ships no .d.ts.
// Shapes taken from its README ("Processing the result") and node example.
declare module 'occt-import-js' {
  export interface OcctImportParams {
    /** Output linear unit. Default 'millimeter'. Our canonical unit (CLAUDE.md). */
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
    linearDeflection?: number
    angularDeflection?: number
  }

  export interface OcctNode {
    name: string
    /** Indices into OcctResult.meshes owned by this node. */
    meshes: number[]
    children: OcctNode[]
  }

  export interface OcctBrepFace {
    first: number
    last: number
    color: [number, number, number] | null
  }

  export interface OcctMesh {
    name: string
    color?: [number, number, number]
    brep_faces: OcctBrepFace[]
    attributes: {
      /** Flat vertex positions as number triplets (plain JS array). */
      position: { array: number[] }
      /** Flat normals as number triplets; absent on some meshes. */
      normal?: { array: number[] }
    }
    /** Triangle vertex indices as number triplets. */
    index: { array: number[] }
  }

  export interface OcctResult {
    success: boolean
    root: OcctNode
    meshes: OcctMesh[]
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctImportParams | null): OcctResult
    ReadBrepFile(content: Uint8Array, params: OcctImportParams | null): OcctResult
    ReadIgesFile(content: Uint8Array, params: OcctImportParams | null): OcctResult
  }

  export interface OcctModuleOptions {
    /** Emscripten hook: return the URL the .wasm binary is fetched from. */
    locateFile?: (path: string, scriptDirectory: string) => string
  }

  const factory: (options?: OcctModuleOptions) => Promise<OcctModule>
  export default factory
}
