import { useAppStore } from '../store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Thin declarative island (ADR-0006): reads the import slice, renders status,
// the parts list, and timing. All logic lives in the pipeline/store.
export default function ImportResult() {
  const status = useAppStore((s) => s.status)
  const file = useAppStore((s) => s.file)
  const parts = useAppStore((s) => s.parts)
  const error = useAppStore((s) => s.error)
  const stats = useAppStore((s) => s.stats)

  if (status === 'idle') return null

  return (
    <section className="import-result" data-testid="import-result" data-status={status}>
      {file && (
        <p className="import-file" data-testid="import-file">
          {status === 'parsing' ? 'Parsing' : 'Loaded'} <strong>{file.name}</strong> (
          {formatSize(file.sizeBytes)})
        </p>
      )}

      {status === 'failed' && (
        <p className="import-error" data-testid="import-error">
          {error}
        </p>
      )}

      {status === 'done' && stats && (
        <>
          <p className="import-stats" data-testid="import-stats">
            {stats.partCount} {stats.partCount === 1 ? 'part' : 'parts'} ·{' '}
            {stats.triangleCount.toLocaleString()} triangles · {Math.round(stats.elapsedMs)} ms
          </p>
          <ul className="parts-list" data-testid="parts-list">
            {parts.map((part, i) => (
              <li key={`${part.name}-${i}`}>{part.name}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
