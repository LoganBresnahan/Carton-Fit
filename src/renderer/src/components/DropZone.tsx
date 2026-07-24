import { useRef, useState } from 'react'
import { importFile } from '../import/service'

const ACCEPTED = ['.stp', '.step', '.stl']

function accepted(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED.some((ext) => lower.endsWith(ext))
}

export default function DropZone() {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function takeFile(file: File | undefined) {
    if (!file) return
    if (!accepted(file.name)) {
      setError(`Unsupported file type — expected ${ACCEPTED.join(', ')}`)
      return
    }
    setError(null)
    // Hand off to the import pipeline; parse status + parts land in the store.
    void importFile(file)
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      data-testid="dropzone"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        takeFile(e.dataTransfer.files[0])
      }}
      onClick={() => inputRef.current?.click()}
    >
      <p>Drag a model here ({ACCEPTED.join(', ')})</p>
      <p className="dropzone-hint">or click to browse</p>
      {error && <p className="dropzone-error">{error}</p>}
      {/* Picker path is the e2e seam (ADR-0005) — OS drag-drop can't be automated */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        data-testid="file-input"
        hidden
        onChange={(e) => takeFile(e.target.files?.[0] ?? undefined)}
      />
    </div>
  )
}
