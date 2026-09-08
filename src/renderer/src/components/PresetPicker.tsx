import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import {
  deleteConfiguration,
  loadConfiguration,
  refreshConfigurations,
  saveConfiguration
} from '../storage/configurations'

// Presets as a picker beside the carton inputs (ADR-0034 §5). A preset IS
// carton inputs — carton, clearances, cap — so a select-plus-save-plus-delete
// next to the fields it fills is where a person looks for it. The standalone
// list of names, one row and two buttons each, is gone; twelve presets are
// twelve options now.
//
// VOCABULARY STAYS. ADR-0016 §3 fixed "reusable carton setups — no part
// attached" as the line that keeps presets and saved estimates apart, and it
// stays under the picker in those words.
//
// THE SELECT SHOWS THE LAST PRESET APPLIED, until the inputs move. A picker
// that kept reading "Standard carton" after the length was changed would be
// lying about what is in the fields, so any settings write after the apply
// clears it back to the placeholder. The one write the apply itself makes is
// skipped, by a ref set before the load and consumed by the first settings
// change after it.
//
// A declarative island over the store (ADR-0006): the list is store state, the
// writes go through the storage service, and storage failures reach the
// StorageBanner through `storageError` rather than being shown here.

export function PresetPicker(): React.JSX.Element {
  const configurations = useAppStore((s) => s.configurations)
  const settings = useAppStore((s) => s.settings)
  const activeCustomerId = useAppStore((s) => s.activeCustomerId)
  const customers = useAppStore((s) => s.customers)
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const applying = useRef(false)

  useEffect(() => {
    void refreshConfigurations()
  }, [])

  // Any settings change that is not the apply itself takes the fields off the
  // preset; the mount run harmlessly sets '' to ''.
  useEffect(() => {
    if (applying.current) {
      applying.current = false
      return
    }
    setSelected('')
  }, [settings])

  // A preset deleted elsewhere (there is nowhere else today, but the list is
  // main's) must not stay selected.
  useEffect(() => {
    if (selected !== '' && !configurations.some((c) => c.name === selected)) setSelected('')
  }, [configurations, selected])

  const trimmed = name.trim()

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const apply = (next: string): void => {
    if (next === '') {
      setSelected('')
      return
    }
    applying.current = true
    void run(async () => {
      const ok = await loadConfiguration(next)
      if (ok) setSelected(next)
      else applying.current = false
    })
  }

  const empty = configurations.length === 0

  // House plus the active customer's first, ungrouped (ADR-0035 §3); every
  // other customer's under one group. That IS "All", one scroll away in the
  // same control, and the group label says whose a preset is.
  const mine = configurations.filter(
    (c) => c.customerId === null || c.customerId === activeCustomerId
  )
  const others = configurations.filter(
    (c) => c.customerId !== null && c.customerId !== activeCustomerId
  )
  const customerName = (id: number | null): string =>
    id === null ? 'House' : (customers.find((c) => c.id === id)?.name ?? `customer #${id}`)

  return (
    <div className="preset-picker" data-testid="configurations-panel">
      <div className="preset-row">
        <select
          className="preset-select"
          data-testid="preset-select"
          aria-label="Preset"
          title="Apply a saved carton setup to these fields"
          value={selected}
          disabled={busy || empty}
          onChange={(e) => apply(e.target.value)}
        >
          <option value="">{empty ? 'No presets yet' : 'Apply a preset…'}</option>
          {mine.map((config) => (
            <option key={config.id} value={config.name} data-testid="config-item">
              {config.name}
            </option>
          ))}
          {others.length > 0 && (
            <optgroup label="Other customers" data-testid="config-others">
              {others.map((config) => (
                <option key={config.id} value={config.name} data-testid="config-item">
                  {config.name} — {customerName(config.customerId)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          data-testid={selected === '' ? 'config-delete' : `config-delete-${selected}`}
          title={selected === '' ? 'Pick a preset to delete it' : `Delete the preset “${selected}”`}
          disabled={busy || selected === ''}
          onClick={() =>
            void run(async () => {
              if (await deleteConfiguration(selected)) setSelected('')
            })
          }
        >
          Delete
        </button>
      </div>
      <div className="preset-row">
        <input
          type="text"
          placeholder="Name this carton setup"
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
              if (await saveConfiguration(trimmed)) {
                // Saved from these fields, so the fields ARE this preset now.
                applying.current = false
                setSelected(trimmed)
                setName('')
              }
            })
          }
        >
          Save
        </button>
      </div>
      <p className="panel-hint">
        Reusable carton setups — no part attached.
        {activeCustomerId !== null && (
          <span data-testid="config-save-for">
            {' '}
            Saved for {customerName(activeCustomerId)}.
          </span>
        )}
      </p>
    </div>
  )
}
