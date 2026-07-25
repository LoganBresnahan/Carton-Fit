import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import {
  deleteConfiguration,
  loadConfiguration,
  refreshConfigurations,
  saveConfiguration
} from '../storage/configurations'

// Saved configurations (VISION: "box/constraint setups can be saved as named
// configurations and reloaded"; ADR-0007).
//
// A declarative island over the store (ADR-0006): it reads the preset list from
// state and calls the storage service for writes. No IPC, no channel names, and
// no async state of its own beyond the name being typed.

export function ConfigurationsPanel(): React.JSX.Element {
  const configurations = useAppStore((s) => s.configurations)
  const storageError = useAppStore((s) => s.storageError)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Load the list once on mount. Storage may be unavailable (it opens lazily in
  // main and is allowed to fail) — refreshConfigurations records that in
  // storageError rather than throwing.
  useEffect(() => {
    void refreshConfigurations()
  }, [])

  const trimmed = name.trim()

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" data-testid="configurations-panel">
      <h2>Saved configurations</h2>

      <div className="config-save">
        <input
          type="text"
          placeholder="Name this setup"
          aria-label="Configuration name"
          data-testid="config-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          data-testid="config-save"
          // A blank name is rejected by the store anyway; disabling says so
          // before the user finds out via an error.
          disabled={busy || trimmed === ''}
          onClick={() =>
            void run(async () => {
              if (await saveConfiguration(trimmed)) setName('')
            })
          }
        >
          Save
        </button>
      </div>

      {configurations.length === 0 ? (
        <p className="muted" data-testid="config-empty">
          No saved configurations yet.
        </p>
      ) : (
        <ul className="config-list" data-testid="config-list">
          {configurations.map((config) => (
            <li key={config.id} data-testid="config-item">
              <span className="config-name">{config.name}</span>
              <button
                type="button"
                data-testid={`config-load-${config.name}`}
                disabled={busy}
                onClick={() => void run(() => loadConfiguration(config.name))}
              >
                Load
              </button>
              <button
                type="button"
                data-testid={`config-delete-${config.name}`}
                disabled={busy}
                onClick={() => void run(() => deleteConfiguration(config.name))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {storageError !== null && (
        <p className="error" data-testid="config-error" role="alert">
          {storageError}
        </p>
      )}
    </section>
  )
}
