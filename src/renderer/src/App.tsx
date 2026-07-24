import DropZone from './components/DropZone'
import ImportResult from './components/ImportResult'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Packaging Estimator</h1>
      </header>
      <main className="app-main">
        <DropZone />
        <ImportResult />
      </main>
    </div>
  )
}
