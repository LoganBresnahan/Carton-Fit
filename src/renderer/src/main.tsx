import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startAutoPack } from './packing/service'
import { installUndoKeyboard, startUndoHistory } from './history/undo'
import { checkForUpdate } from './update/service'
import './styles.css'

// The estimate follows the inputs: this subscription re-packs whenever the
// imported parts or the packing settings change (roadmap item 4). Installed at
// the entry, not in a component, so it is independent of the React tree.
startAutoPack()

// Ctrl+Z / Ctrl+Shift+Z over the inputs (ADR-0016). In memory and session
// scoped — under auto-run, undoing an input is undoing the estimate.
startUndoHistory()
installUndoKeyboard(window)

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
