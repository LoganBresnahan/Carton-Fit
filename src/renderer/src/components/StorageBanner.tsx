import { useAppStore } from '../store'

/**
 * The one always-visible place storage trouble is reported.
 *
 * Storage is optional by design — main opens the database lazily and tolerates
 * failure (ADR-0007) — which is exactly why a failure has to be *said*. Until
 * now the only report lived inside the configurations panel, at the bottom of a
 * scrolling column, so a user who never scrolled there was never told that
 * their saves were not saving and their history was not being kept. Silence
 * read as success.
 *
 * Pinned as a sibling of the scroll region rather than placed inside it, the
 * same way the results panel is pinned below: `.panel` is a flex column and
 * only `.panel-scroll` scrolls.
 */
export default function StorageBanner(): React.JSX.Element | null {
  const storageError = useAppStore((s) => s.storageError)
  if (storageError === null) return null

  return (
    <div className="storage-banner" data-testid="storage-error" role="alert">
      <span className="storage-banner-label">Storage</span>
      <span className="storage-banner-message">{storageError}</span>
    </div>
  )
}
