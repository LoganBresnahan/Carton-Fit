import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startAutoPack } from './packing/service'
import { installUndoKeyboard, startUndoHistory } from './history/undo'
import { installPanelWidthKeyboard, installPanelWidthResize } from './layout/panel-controls'
import { checkForUpdate } from './update/service'
import { startDriveHost } from './mcp/driveHost'
import './styles.css'

// The estimate follows the inputs: this subscription re-packs whenever the
// imported parts or the packing settings change (roadmap item 4). Installed at
// the entry, not in a component, so it is independent of the React tree.
startAutoPack()

// Ctrl+Z / Ctrl+Shift+Z over the inputs (ADR-0016). In memory and session
// scoped — under auto-run, undoing an input is undoing the estimate.
startUndoHistory()
installUndoKeyboard(window)

// The control panel's width (ADR-0026). `<` / `>` step it; the resize listener
// re-clamps a width saved on a wider monitor, so it cannot pin the viewport to
// a sliver here. Installed at the entry beside undo's binding, for the same
// reason: neither belongs to a component. The drag handle IS a component —
// it needs the column's own left edge.
installPanelWidthKeyboard(window)
installPanelWidthResize(window)

// The MCP drive host (ADR-0029 v2): answers main's drive requests through the
// store's own actions. Installed unconditionally — main only sends requests in
// --mcp-server mode, and a listener nobody calls costs nothing.
startDriveHost()

// Ask main what its launch check found (ADR-0021). Fire-and-forget: it resolves
// to null for "current" and for every failure alike, and nothing waits on it.
void checkForUpdate()

// Estimates are NOT recorded automatically. ADR-0009 removed the compute
// button, so "every estimate" would mean every debounced keystroke; ADR-0016
// made saving explicit instead. See storage/estimates.ts.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
