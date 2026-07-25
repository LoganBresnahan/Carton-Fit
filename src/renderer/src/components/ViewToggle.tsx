import { useAppStore } from '../store'

// Model ⇄ packed view toggle (VISION: "toggle between model view and packed
// view"). Overlaid on the viewport rather than placed in the input panel — it
// controls what the canvas shows, so it belongs on the canvas.
//
// Choosing either side PINS it: without that, inspecting the model would be
// undone by the next re-pack, which is a keystroke away under ADR-0009.

export default function ViewToggle() {
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const hasResult = useAppStore((s) => s.packResult !== null)
  const hasParts = useAppStore((s) => s.parts.length > 0)

  if (!hasParts || !hasResult) return null

  const showingPacked = viewMode !== 'model'

  return (
    <div className="view-toggle segmented" role="radiogroup" aria-label="3D view" data-testid="view-toggle">
      <button
        type="button"
        role="radio"
        aria-checked={!showingPacked}
        className={`segment${!showingPacked ? ' active' : ''}`}
        data-testid="view-model"
        onClick={() => setViewMode('model')}
      >
        Model
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={showingPacked}
        className={`segment${showingPacked ? ' active' : ''}`}
        data-testid="view-packed"
        onClick={() => setViewMode('packed')}
      >
        Packed
      </button>
    </div>
  )
}
