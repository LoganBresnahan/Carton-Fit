// The update-check contract, shared by all three processes (ADR-0021).
//
// Same discipline as `shared/storage.ts` and `shared/exportFile.ts`: TYPES AND
// CONSTANTS ONLY, because this file is imported into the renderer bundle and
// must not drag Electron or node: modules in with it.
//
// The split of responsibility is the decision. MAIN owns the network call and
// the URL it found; the RENDERER owns only the sentence on screen. Note what is
// NOT here: no URL travels renderer→main. `openReleasePage` takes no argument,
// so the renderer can ask for the page main fetched but cannot nominate one —
// a renderer-supplied URL would turn `shell.openExternal` into an
// open-anything launcher reachable from page content.

export const UPDATE_CHANNELS = {
  check: 'update:check',
  openRelease: 'update:open-release'
} as const

export interface UpdateInfo {
  /** The newer version, without the tag's leading `v` — for display only. */
  readonly version: string
}

export interface UpdateApi {
  /**
   * The launch check's result: the newer version, or null.
   *
   * Null covers "you are current" AND every failure — offline, rate-limited, a
   * changed response shape, an unparseable tag (ADR-0021 §3). The caller cannot
   * tell them apart, on purpose: there is nothing a user of a packing estimator
   * should be told about a GitHub API 403.
   *
   * Resolves against ONE network request per app launch, however many times the
   * renderer asks or reloads.
   */
  check(): Promise<UpdateInfo | null>
  /** Open that release's page in the system browser. No-op if none was found. */
  openReleasePage(): Promise<void>
}
