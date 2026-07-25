import DropZone from './components/DropZone'
import ImportResult from './components/ImportResult'
import ModeTierSelectors from './components/ModeTierSelectors'
import InputsPanel from './components/InputsPanel'
import ResultsPanel from './components/ResultsPanel'
import UnitPicker from './components/UnitPicker'
import ViewToggle from './components/ViewToggle'
import Viewport from './viewport/Viewport'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Packaging Estimator</h1>
      </header>
      <main className="app-main">
        {/* Inputs scroll; the estimate is pinned below them as a footer, so the
            answer stays on screen while the carton and weight fields are edited. */}
        <div className="panel">
          <div className="panel-scroll">
            <DropZone />
            <ImportResult />
            <ModeTierSelectors />
            <UnitPicker />
            <InputsPanel />
          </div>
          <ResultsPanel />
        </div>
        <div className="stage">
          <Viewport />
          <ViewToggle />
        </div>
      </main>
    </div>
  )
}
