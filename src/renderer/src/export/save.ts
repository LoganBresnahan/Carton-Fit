import { captureViewportPng, dataUrlToBase64 } from '../viewport/capture'
import type { ExportApi } from '../../../shared/exportFile'
import { buildCsv } from './csv'
import { collectExport, suggestedFileName } from './collect'

// The two file exports, as services rather than component logic (ADR-0006):
// collect what is on screen, build the bytes, hand them to main. Components
// call these and render the outcome.

/** What a component needs to say afterwards. `path` null with no error means
 *  the user cancelled — a non-event, and it must not read as a failure. */
export interface SaveOutcome {
  saved: boolean
  error: string | null
}

const CANCELLED: SaveOutcome = { saved: false, error: null }

function api(injected?: ExportApi): ExportApi {
  return injected ?? window.api.exportFile
}

/**
 * Wrap the IPC so a rejected invoke cannot reach the UI raw.
 *
 * Main answers cancellation and write failures as DATA, so a rejection here is
 * something else entirely — the channel missing, or preload not loaded. It
 * still has to become a sentence rather than an unhandled promise.
 */
async function send(
  injected: ExportApi | undefined,
  request: Parameters<ExportApi['save']>[0]
): Promise<SaveOutcome> {
  try {
    const result = await api(injected).save(request)
    if (result.error) return { saved: false, error: result.error }
    return result.path ? { saved: true, error: null } : CANCELLED
  } catch (error) {
    return { saved: false, error: (error as Error).message }
  }
}

/** Save the measurements table. */
export async function saveCsv(injected?: ExportApi): Promise<SaveOutcome> {
  const input = collectExport()
  if (!input) return CANCELLED
  return send(injected, {
    suggestedName: suggestedFileName(input, 'csv'),
    extension: 'csv',
    description: 'CSV spreadsheet',
    text: buildCsv(input)
  })
}

/**
 * Save the packed view as a PNG.
 *
 * The capture is taken BEFORE the dialog opens, deliberately: the dialog is
 * modal and can sit open for a while, and a re-pack behind it would otherwise
 * let the file show a different arrangement than the one that was on screen
 * when the button was pressed.
 */
export async function savePng(injected?: ExportApi): Promise<SaveOutcome> {
  const input = collectExport()
  if (!input) return CANCELLED

  const dataUrl = captureViewportPng()
  if (!dataUrl) {
    return { saved: false, error: 'The 3D view is not available to capture.' }
  }

  return send(injected, {
    suggestedName: suggestedFileName(input, 'png'),
    extension: 'png',
    description: 'PNG image',
    base64: dataUrlToBase64(dataUrl)
  })
}
