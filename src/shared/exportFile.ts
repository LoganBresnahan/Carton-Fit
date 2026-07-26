// The file-export contract, shared by all three processes (ADR-0017 §3).
//
// Same discipline as `shared/storage.ts`: TYPES AND CONSTANTS ONLY, because
// this file is imported into the renderer bundle and must not drag Electron or
// node:fs in with it. Channel names live here so the renderer never spells one.
//
// The split of responsibility is the decision: the RENDERER decides what the
// bytes are (it owns the estimate and the wording), MAIN decides where they go
// and performs the write (it owns the dialog and the filesystem). Neither half
// can be tempted into the other's job.

export const EXPORT_CHANNELS = {
  save: 'export:save'
} as const

export interface ExportSaveRequest {
  /** Pre-sanitized name offered in the dialog — `suggestedFileName` builds it. */
  readonly suggestedName: string
  /** Extension without the dot, for the dialog's filter (`csv`, `png`). */
  readonly extension: string
  /** Human name for that filter, e.g. "CSV spreadsheet". */
  readonly description: string
  /**
   * The file contents. A string is written as UTF-8; a base64 payload is
   * decoded first, which is how the PNG travels — structured cloning would
   * carry a Uint8Array too, but base64 keeps the channel to one JSON-ish shape
   * and the canvas hands us base64 anyway.
   */
  readonly text?: string
  readonly base64?: string
}

export interface ExportSaveResult {
  /** Where it was written, or null when the user cancelled the dialog. */
  readonly path: string | null
  /** Set only when the write itself failed — cancelling is not an error. */
  readonly error: string | null
}

export interface ExportApi {
  save(request: ExportSaveRequest): Promise<ExportSaveResult>
}
