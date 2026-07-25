// Content identity for an imported model (ADR-0007 `estimates.content_hash`).
//
// History is keyed on what the file CONTAINS, not what it is called: a part
// renamed on disk, or the same geometry sent by two people under different
// names, should land on one history thread. Name+size would fail both.
//
// SHA-256 via WebCrypto. Verified available in the packaged app — `file://` is
// a secure context under Electron (`isSecureContext: true`, `crypto.subtle`
// present, digest returns 32 bytes), which is not a safe assumption in a plain
// browser and so was measured rather than assumed.
//
// This is identity, not security: nothing downstream trusts the hash to prove
// provenance, so a collision would merge two history threads and nothing worse.

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
