import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startAutoPack } from './packing/service'
import './styles.css'

// The estimate follows the inputs: this subscription re-packs whenever the
// imported parts or the packing settings change (roadmap item 4). Installed at
// the entry, not in a component, so it is independent of the React tree.
startAutoPack()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
