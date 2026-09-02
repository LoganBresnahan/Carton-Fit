import { useEffect, useRef, useState } from 'react'
import type { ClientStatus, ManualField } from '../../../shared/connect'

// One MCP client's row (ADR-0030 slice `connect-panel-rows`).
//
// EVERY SENTENCE HERE NAMES THE CLIENT rather than assuming Claude Desktop.
// That is not tidiness: the panel now renders a row for a client that is very
// often NOT installed (Codex on a Linux machine, Consequence 5), and a row
// whose copy said "Claude Desktop isn't installed" under a heading reading
// "ChatGPT (Codex)" would be a bug the user has to decode.
//
// THE RESTART LINE IS STILL THE FEATURE, NOT A FOOTNOTE — and it generalises
// unchanged, because it was never about Claude. Both clients read their MCP
// configuration when they start, so a correct write connects nothing until the
// client is restarted; without that sentence the successful case looks exactly
// like the broken one, and the user's next move is to doubt the button.
//
// The renderer COMPOSES NOTHING. Every string below is either UI prose about a
// state, or a value main handed over in `status.manual` — no path is built
// here, no command is spelled here, and the click sends an id and nothing else
// (see `shared/connect.ts`).

/** How long a copy confirmation stays up — matched to `CopySummaryButton`'s,
 *  since it is the same gesture and a different dwell reads as a different
 *  kind of event. */
const CONFIRM_MS = 1800

interface Props {
  readonly status: ClientStatus
  /** True only when THIS row's button just wrote the client's config — so the
   *  restart line appears for someone who has something to restart, and not
   *  for someone who was already connected when the panel mounted. */
  readonly justWrote: boolean
  readonly busy: boolean
  readonly onConnect: () => void
}

export default function ConnectClientRow({
  status,
  justWrote,
  busy,
  onConnect,
}: Props): React.JSX.Element {
  const name = status.displayName
  const id = status.id

  return (
    <li className="connect-row" data-testid={`connect-${id}-row`}>
      <h3 className="connect-name">{name}</h3>

      {status.state === 'not-detected' ? (
        // No button at all rather than a disabled one: there is nothing that
        // would enable it, and writing a config for a program that is not
        // installed would be litter under a name its owner never chose. The
        // manual fields below still render — this is precisely the state where
        // we cannot write anything and the user may still have that client on
        // another machine.
        <p className="muted" data-testid={`connect-${id}-not-detected`}>
          {name} isn’t installed on this computer. Install it, then come back.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="save-estimate"
            data-testid={`connect-${id}-connect`}
            disabled={busy}
            title={`Adds Carton Fit to ${status.location}`}
            onClick={onConnect}
          >
            {status.state === 'connected' ? 'Reconnect' : `Connect to ${name}`}
          </button>

          {status.state === 'connected' && (
            <p className="muted" data-testid={`connect-${id}-connected`}>
              {justWrote
                ? `Connected. Restart ${name} to finish.`
                : `Connected. Restart ${name} if it was open when this was set up.`}
            </p>
          )}
          {status.state === 'outdated' && (
            <p className="muted" data-testid={`connect-${id}-outdated`}>
              {name} points at a different copy of Carton Fit. Reconnect to point it here.
            </p>
          )}
          {status.state === 'not-connected' && (
            <p className="muted" data-testid={`connect-${id}-not-connected`}>
              Not connected yet.
            </p>
          )}
          {status.state === 'error' && (
            // Loud, and it names the location: the failure mode this replaces
            // is a button that looks like it worked and a client that never
            // connects, so the user's next move is to go and look.
            <p className="error" data-testid={`connect-${id}-error`}>
              {status.problem} {status.location !== '' && `(${status.location})`}
            </p>
          )}
        </>
      )}

      {status.manual !== undefined && <ManualFallback id={id} manual={status.manual} />}
    </li>
  )
}

/**
 * Setting this client up by hand (ADR-0030 Decision 2, mechanism 3).
 *
 * COLLAPSED BY DEFAULT, and that is the only judgement this component makes.
 * The fields are present in every state — a user whose Connect just failed
 * needs them without another round trip — but a permanently expanded block of
 * eight labelled paths under a button that works for almost everyone would
 * make the ordinary case look like the hard one.
 *
 * ONE COPY BUTTON PER FIELD, because one box per field is what the client's own
 * form asks for (the ADR's second addendum). A single "copy everything" would
 * hand back exactly the concatenated line that addendum rejected.
 */
function ManualFallback({
  id,
  manual,
}: {
  id: string
  manual: NonNullable<ClientStatus['manual']>
}): React.JSX.Element {
  return (
    <details className="connect-manual" data-testid={`connect-${id}-manual`}>
      <summary>Set it up by hand</summary>
      <p className="panel-hint">{manual.intro}</p>
      <ol className="connect-fields">
        {manual.fields.map((field, index) => (
          <ManualFieldRow key={field.label} id={id} index={index} field={field} />
        ))}
      </ol>
    </details>
  )
}

function ManualFieldRow({
  id,
  index,
  field,
}: {
  id: string
  index: number
  field: ManualField
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function flash(ok: boolean): void {
    setCopied(ok)
    setFailed(!ok)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, CONFIRM_MS)
  }

  return (
    <li className="connect-field" data-testid={`connect-${id}-field-${index}`}>
      <span className="connect-field-label">{field.label}</span>
      {/* The value is SELECTABLE TEXT, not an input: a user who does not trust
          a clipboard button — or whose platform refused it — must still be able
          to read the whole thing and drag over it. `block` values are JSON and
          wrap; single-line values scroll, because truncating a path with an
          ellipsis would silently hand back the wrong string. */}
      <code className={field.block === true ? 'connect-field-block' : 'connect-field-value'}>
        {field.value}
      </code>
      <button
        type="button"
        className="save-estimate"
        data-testid={`connect-${id}-copy-${index}`}
        title={`Copy ${field.label}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(field.value)
            .then(() => flash(true))
            // Clipboard access can be refused by the platform. Saying so beats
            // a button that appears to work and silently copies nothing — and
            // here it matters twice over, since the text beside it is the
            // fallback for someone whose Connect already failed once.
            .catch(() => flash(false))
        }}
      >
        {copied ? 'Copied ✓' : failed ? 'Copy failed' : 'Copy'}
      </button>
    </li>
  )
}
