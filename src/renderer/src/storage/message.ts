// Turn a rejected storage call into something worth showing a user.
//
// `ipcRenderer.invoke` wraps every rejection from the main process, so the
// message that reaches the renderer reads:
//
//   Error invoking remote method 'storage:configurations:list': Error: storage
//   is unavailable: database schema is version 999, but this build only
//   understands 1. …
//
// The part after the last prefix is a sentence written FOR the user (see
// db/migrations.ts). Everything before it is plumbing — a channel name and a
// doubled-up class name — and it pushed the useful text off the first two lines
// of the banner.

const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/
/** One or more `Error:` / `TypeError:` style prefixes left by rethrowing. */
const ERROR_PREFIXES = /^(?:[A-Za-z]*Error:\s*)+/

/** The user-facing sentence inside a storage rejection. */
export function storageMessage(error: unknown): string {
  const raw = (error as Error)?.message ?? String(error)
  const message = raw.replace(IPC_WRAPPER, '').replace(ERROR_PREFIXES, '').trim()
  // Never return an empty banner: if stripping consumed everything, the raw
  // text is ugly but at least it is information.
  return message === '' ? raw : message
}
