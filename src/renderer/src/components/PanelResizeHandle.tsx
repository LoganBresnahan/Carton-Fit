import { useAppStore } from '../store'
import { clampPanelWidth, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from '../layout/panel-width'
import { defaultPanelWidth } from '../layout/panel-controls'

/**
 * The drag handle on the panel's right edge (ADR-0026 §1).
 *
 * No visible chrome at rest: the 1px border is the seam, and this is a 6px
 * invisible hit area over it wearing `cursor: col-resize` — the affordance
 * every IDE teaches. Double-click resets to the default.
 *
 * It lives inside `.panel` and reads that element's left edge on pointerdown,
 * which is why this is a component rather than another window listener: a
 * pointer position only becomes a width relative to where the column starts.
 * The left edge is read ONCE per drag — it cannot move mid-drag, and re-reading
 * it per move would measure a layout this very drag is changing.
 */
export default function PanelResizeHandle() {
  const setPanelWidth = useAppStore((s) => s.setPanelWidth)
  const panelWidth = useAppStore((s) => s.panelWidth)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Primary button only: a right-click here is a context menu, not a drag.
    if (event.button !== 0) return
    const panel = event.currentTarget.parentElement
    if (panel === null) return
    const left = panel.getBoundingClientRect().left
    const handle = event.currentTarget

    // Stops the drag selecting the text it passes over.
    event.preventDefault()
    // Pointer capture is what makes the drag survive leaving the 6px strip —
    // every subsequent move retargets here, however far away the cursor is.
    handle.setPointerCapture(event.pointerId)

    const onMove = (moved: PointerEvent): void => {
      setPanelWidth(clampPanelWidth(moved.clientX - left, window.innerWidth))
    }
    // pointercancel as well as pointerup: the OS can revoke a pointer mid-drag
    // (a touch becoming a gesture, a window losing focus), and only unbinding
    // on `up` would leave the listener live for the next stray move.
    const onEnd = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const onDoubleClick = (): void => {
    setPanelWidth(defaultPanelWidth(window.innerWidth))
  }

  return (
    <div
      className="panel-resize-handle"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize control panel"
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={MAX_PANEL_WIDTH}
      aria-valuenow={panelWidth}
    />
  )
}
