import DropZone from './components/DropZone'
import { useAppStore } from './store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function App() {
  const file = useAppStore((s) => s.file)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Packaging Estimator</h1>
      </header>
      <main className="app-main">
        <DropZone />
        {file && (
          <p className="file-info" data-testid="file-info">
            Loaded <strong>{file.name}</strong> ({formatSize(file.sizeBytes)})
          </p>
        )}
      </main>
    </div>
  )
}
