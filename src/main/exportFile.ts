import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  EXPORT_CHANNELS,
  type ExportSaveRequest,
  type ExportSaveResult
} from '../shared/exportFile'

// The export save surface (ADR-0017 §3): show a save dialog, write the bytes.
//
// Deliberately the dumbest handler in main. It knows nothing about estimates,
// packing or units — only about a name, an extension and some bytes. Every
// decision about CONTENT stays in the renderer where the estimate lives, which
// is what keeps this from growing into a second reporting layer.

/**
 * Cancel is not an error, and a failed write is not a crash.
 *
 * Both come back as data, because a rejected invoke reaches the renderer as
 * `Error invoking remote method '…'` — the exact wrapper that had to be
 * stripped from the storage banner. Here we simply never generate it.
 */
export function registerExportIpc(): void {
  ipcMain.handle(
    EXPORT_CHANNELS.save,
    async (event, request: ExportSaveRequest): Promise<ExportSaveResult> => {
      // Parent the dialog to the window that asked, so it is modal to that
      // window rather than floating free.
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        defaultPath: request.suggestedName,
        filters: [
          { name: request.description, extensions: [request.extension] },
          { name: 'All files', extensions: ['*'] }
        ]
      }

      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return { path: null, error: null }

      try {
        const bytes =
          request.base64 !== undefined
            ? Buffer.from(request.base64, 'base64')
            : Buffer.from(request.text ?? '', 'utf8')
        await writeFile(filePath, bytes)
        return { path: filePath, error: null }
      } catch (error) {
        // A read-only folder, a full disk, a name the filesystem refuses — the
        // user chose this location, so they are the one who can fix it.
        return { path: null, error: (error as Error).message }
      }
    }
  )
}
