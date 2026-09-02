import DropZone from './components/DropZone'
import ImportResult from './components/ImportResult'
import ModeTierSelectors from './components/ModeTierSelectors'
import InputsPanel from './components/InputsPanel'
import PanelResizeHandle from './components/PanelResizeHandle'
import PartWeightsPanel from './components/PartWeightsPanel'
import ResultsPanel from './components/ResultsPanel'
import StorageBanner from './components/StorageBanner'
import ThemeSelect from './components/ThemeSelect'
import UpdateBanner from './components/UpdateBanner'
import UnitPicker from './components/UnitPicker'
import ClaudeConnectPanel from './components/ClaudeConnectPanel'
import { ConfigurationsPanel } from './components/ConfigurationsPanel'
import SavedEstimatesPanel from './components/SavedEstimatesPanel'
import ViewToggle from './components/ViewToggle'
import Viewport from './viewport/Viewport'
import { useAppStore } from './store'

export default function App() {
  // Layout, so it lives here rather than in any input component (ADR-0026 §5).
  // Read synchronously at store init, so the first paint is already the user's
  // width instead of 360 followed by a jump.
  const panelWidth = useAppStore((s) => s.panelWidth)

  return (
    <div className="app">
      {/* The app-scope status area (ADR-0021 §5): the only region that is
          always visible, horizontally roomy, and cannot scroll. Storage is
          rendered first because a malfunction outranks news. */}
      <header className="app-header">
        <h1>Carton Fit</h1>
        <div className="header-status">
          {/* Left of the chips, and it never shrinks: the chips are what absorb
              truncation (ADR-0021 §7), and a half-width select is unusable
              where a truncated sentence is merely shorter. */}
          <ThemeSelect />
          <StorageBanner />
          <UpdateBanner />
        </div>
      </header>
      <main className="app-main">
        {/* Inputs scroll; the estimate is pinned below them as a footer, so the
            answer stays on screen while the carton and weight fields are edited. */}
        <div
          className="panel"
          style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}
        >
          <div className="panel-scroll">
            <DropZone />
            <ImportResult />
            <ModeTierSelectors />
            <UnitPicker />
            <InputsPanel />
            {/* Directly under the weight inputs it overrides — the section is
                a correction to them, not an unrelated feature. */}
            <PartWeightsPanel />
            <ConfigurationsPanel />
            <SavedEstimatesPanel />
            {/* Last in the column: setup, not an input. Nobody reaches for it
                while estimating, and it is the one section a user touches once
                (ADR-0029, slice `connect-to-claude-button`). */}
            <ClaudeConnectPanel />
          </div>
          <ResultsPanel />
          {/* Last child and absolutely positioned: it overlays the column's
              right edge across BOTH rows, so the grab area does not stop where
              the scroll region does. */}
          <PanelResizeHandle />
        </div>
        <div className="stage">
          <Viewport />
          <ViewToggle />
        </div>
      </main>
    </div>
  )
}
