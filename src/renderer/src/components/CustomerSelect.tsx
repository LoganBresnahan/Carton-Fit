import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { createCustomer, refreshCustomers } from '../storage/customers'

// "Working for" (ADR-0035 §3): the active customer, in the header beside the
// other app-wide, not-an-input controls. A select, like the theme, because
// every option has to be visible — "House" behind a button reads as an
// action. The last option creates a customer; that is the person's act, so
// it opens a small dialog for the name rather than a tool.

const NEW = '__new__'

export default function CustomerSelect(): React.JSX.Element {
  const customers = useAppStore((s) => s.customers)
  const activeId = useAppStore((s) => s.activeCustomerId)
  const setActive = useAppStore((s) => s.setActiveCustomer)
  const dialog = useRef<HTMLDialogElement>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshCustomers()
  }, [])

  useEffect(() => {
    const el = dialog.current
    if (el === null) return
    if (creating && !el.open) el.showModal()
    if (!creating && el.open) el.close()
  }, [creating])

  const choose = (value: string): void => {
    if (value === NEW) {
      setCreating(true)
      return
    }
    setActive(value === '' ? null : Number(value))
  }

  const trimmed = name.trim()
  const create = async (): Promise<void> => {
    if (trimmed === '') return
    setBusy(true)
    try {
      if ((await createCustomer(trimmed)) !== null) {
        setName('')
        setCreating(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label className="customer-working" title="Whose cartons and receipts the lists show, and who a save is tagged for">
        <span className="customer-working-label">Working for</span>
        <select
          className="customer-select"
          data-testid="customer-select"
          aria-label="Working for"
          value={activeId === null ? '' : String(activeId)}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">House</option>
          {customers.map((c) => (
            <option key={c.id} value={String(c.id)} data-testid="customer-option">
              {c.name}
            </option>
          ))}
          <option value={NEW}>New customer…</option>
        </select>
      </label>
      <dialog
        ref={dialog}
        className="customer-dialog"
        data-testid="customer-dialog"
        aria-label="New customer"
        onClose={() => setCreating(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setCreating(false)
        }}
      >
        {creating && (
          <form
            className="customer-form"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <h2>New customer</h2>
            <p className="panel-hint">
              A name, nothing else — their cartons are presets saved while working for them.
            </p>
            <input
              type="text"
              autoFocus
              placeholder="Customer name"
              aria-label="Customer name"
              data-testid="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="connect-dialog-actions">
              <button type="button" data-testid="customer-cancel" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" data-testid="customer-create" disabled={busy || trimmed === ''}>
                Create
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}
