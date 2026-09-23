import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import {
  createCustomer,
  customerUsage,
  deleteCustomer,
  refreshCustomers,
  renameCustomer
} from '../storage/customers'
import type { CustomerRow, CustomerUsage } from '../../../shared/storage'

// "Working for" (ADR-0035 §3): the active customer, in the header beside the
// other app-wide, not-an-input controls. A select, like the theme, because
// every option has to be visible — "House" behind a button reads as an
// action. The last options create and manage customers; those are the
// person's acts, so they open a small dialog rather than a tool.
//
// MANAGE (amendment 2): rename per row, and a delete that MOVES. The delete
// step says how many presets and saved estimates carry the customer and asks
// where they go — House or another customer — so a duplicate merges and a
// customer who left folds into House, and nothing is destroyed either way.

const NEW = '__new__'
const MANAGE = '__manage__'

type Mode = 'new' | 'manage' | null

/** "3 presets and 1 saved estimate" — or null when nothing carries the customer. */
export function usagePhrase(usage: CustomerUsage): string | null {
  const parts: string[] = []
  if (usage.presets > 0) parts.push(`${usage.presets} preset${usage.presets === 1 ? '' : 's'}`)
  if (usage.estimates > 0) {
    parts.push(`${usage.estimates} saved estimate${usage.estimates === 1 ? '' : 's'}`)
  }
  return parts.length === 0 ? null : parts.join(' and ')
}

export default function CustomerSelect(): React.JSX.Element {
  const customers = useAppStore((s) => s.customers)
  const activeId = useAppStore((s) => s.activeCustomerId)
  const setActive = useAppStore((s) => s.setActiveCustomer)
  // A refused act (a duplicate name, say) is reported by the storage service to
  // the header's chip — which sits BEHIND this modal. Show it here too, and
  // clear it as each act starts so the sentence is about the act just tried.
  const storageError = useAppStore((s) => s.storageError)
  const clearError = useAppStore((s) => s.setStorageError)
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Manage view: the draft names being typed, keyed by id, and the customer
  // whose delete step is open (with what it tags, and where that goes).
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [deleting, setDeleting] = useState<{ customer: CustomerRow; usage: CustomerUsage } | null>(null)
  const [moveTo, setMoveTo] = useState('')

  useEffect(() => {
    void refreshCustomers()
  }, [])

  useEffect(() => {
    const el = dialog.current
    if (el === null) return
    if (mode !== null && !el.open) el.showModal()
    if (mode === null && el.open) el.close()
  }, [mode])

  const close = (): void => {
    setMode(null)
    setDeleting(null)
    setDrafts({})
    setMoveTo('')
  }

  const choose = (value: string): void => {
    if (value === NEW) return setMode('new')
    if (value === MANAGE) return setMode('manage')
    setActive(value === '' ? null : Number(value))
  }

  const trimmed = name.trim()
  const create = async (): Promise<void> => {
    if (trimmed === '') return
    clearError(null)
    setBusy(true)
    try {
      if ((await createCustomer(trimmed)) !== null) {
        setName('')
        close()
      }
    } finally {
      setBusy(false)
    }
  }

  const rename = async (customer: CustomerRow): Promise<void> => {
    const draft = (drafts[customer.id] ?? customer.name).trim()
    if (draft === '' || draft === customer.name) return
    clearError(null)
    setBusy(true)
    try {
      if (await renameCustomer(customer.id, draft)) {
        setDrafts((d) => {
          const { [customer.id]: _done, ...rest } = d
          return rest
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const askDelete = async (customer: CustomerRow): Promise<void> => {
    const usage = await customerUsage(customer.id)
    if (usage === null) return
    setMoveTo('')
    setDeleting({ customer, usage })
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return
    clearError(null)
    setBusy(true)
    try {
      if (await deleteCustomer(deleting.customer.id, moveTo === '' ? null : Number(moveTo))) {
        setDeleting(null)
        // The last customer gone leaves nothing to manage.
        if (customers.length <= 1) close()
      }
    } finally {
      setBusy(false)
    }
  }

  const carried = deleting === null ? null : usagePhrase(deleting.usage)
  const problem = storageError === null ? null : (
    <p className="customer-error" data-testid="customer-error" role="alert">
      {storageError}
    </p>
  )

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
          {customers.length > 0 && <option value={MANAGE}>Manage customers…</option>}
        </select>
      </label>
      <dialog
        ref={dialog}
        className="customer-dialog"
        data-testid="customer-dialog"
        aria-label={mode === 'manage' ? 'Manage customers' : 'New customer'}
        onClose={close}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        {mode === 'new' && (
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
            {problem}
            <div className="connect-dialog-actions">
              <button type="button" data-testid="customer-cancel" onClick={close}>
                Cancel
              </button>
              <button type="submit" data-testid="customer-create" disabled={busy || trimmed === ''}>
                Create
              </button>
            </div>
          </form>
        )}

        {mode === 'manage' && deleting === null && (
          <div className="customer-form" data-testid="customer-manage">
            <h2>Manage customers</h2>
            <p className="panel-hint">
              Renaming changes the name everywhere it shows. Deleting asks where the customer’s
              presets and saved estimates go first — nothing is thrown away.
            </p>
            <ul className="customer-rows">
              {customers.map((c) => {
                const draft = drafts[c.id] ?? c.name
                const changed = draft.trim() !== '' && draft.trim() !== c.name
                return (
                  <li key={c.id} className="customer-row" data-testid="customer-row">
                    <input
                      type="text"
                      aria-label={`Name of ${c.name}`}
                      data-testid={`customer-rename-input-${c.id}`}
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(c)
                      }}
                    />
                    <button
                      type="button"
                      data-testid={`customer-rename-${c.id}`}
                      disabled={busy || !changed}
                      onClick={() => void rename(c)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      data-testid={`customer-delete-${c.id}`}
                      disabled={busy}
                      onClick={() => void askDelete(c)}
                    >
                      Delete…
                    </button>
                  </li>
                )
              })}
            </ul>
            {problem}
            <div className="connect-dialog-actions">
              <button type="button" data-testid="customer-manage-done" onClick={close}>
                Done
              </button>
            </div>
          </div>
        )}

        {mode === 'manage' && deleting !== null && (
          <form
            className="customer-form"
            data-testid="customer-delete-step"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmDelete()
            }}
          >
            <h2>Delete “{deleting.customer.name}”?</h2>
            {carried === null ? (
              <p className="panel-hint" data-testid="customer-delete-usage">
                Nothing is tagged with this customer.
              </p>
            ) : (
              <>
                <p className="panel-hint" data-testid="customer-delete-usage">
                  {carried} {deleting.usage.presets + deleting.usage.estimates === 1 ? 'is' : 'are'}{' '}
                  tagged with this customer. They are kept, and move to:
                </p>
                <select
                  aria-label="Move them to"
                  data-testid="customer-move-to"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                >
                  <option value="">House</option>
                  {customers
                    .filter((c) => c.id !== deleting.customer.id)
                    .map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </>
            )}
            {problem}
            <div className="connect-dialog-actions">
              <button type="button" data-testid="customer-delete-cancel" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="submit" data-testid="customer-delete-confirm" disabled={busy}>
                Delete customer
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}
