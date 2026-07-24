import DropZone from './components/DropZone'
import ImportResult from './components/ImportResult'
import ModeTierSelectors from './components/ModeTierSelectors'
import InputsPanel from './components/InputsPanel'
import Viewport from './viewport/Viewport'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Packaging Estimator</h1>
      </header>
      <main className="app-main">
        <div className="panel">
          <DropZone />
          <ImportResult />
          <ModeTierSelectors />
          <InputsPanel />
        </div>
        <Viewport />
      </main>
    </div>
  )
}
