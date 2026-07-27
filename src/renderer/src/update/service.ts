import { useAppStore } from '../store'

// The renderer's whole share of the update check (ADR-0021): ask main what it
// found, put it in the store, and — if the user clicks Download — ask main to
// open the page. No URL, no network call, and no CSP hole for api.github.com;
// egress stays in main with every other privileged boundary.

/**
 * Total, like the storage calls in `storage/`: it reports nothing and throws
 * nothing.
 *
 * The catch covers a rejected invoke and also the case where `window.api.update`
 * is missing entirely — a renderer that somehow loaded without the preload
 * should show no banner, not a red error about one.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const info = await window.api.update.check()
    if (info !== null) useAppStore.getState().setUpdateAvailable(info)
  } catch {
    // Every failure is silence (ADR-0021 §3).
  }
}

/** Open the release page in the system browser. */
export async function openReleasePage(): Promise<void> {
  try {
    await window.api.update.openReleasePage()
  } catch {
    // The user asked for a browser and did not get one. There is nothing they
    // could do about it and nothing useful to say, so the banner stays as it is
    // — still true, still carrying the version number they can search for.
  }
}
