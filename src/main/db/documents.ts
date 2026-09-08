import type { Database, Statement } from 'better-sqlite3'
import type { LinkOffer } from '../../shared/storage'

// Document versions (ADR-0034 §3). A document is the set of content hashes a
// part has had across re-exports; `document_versions` maps each later hash to
// the first one. Nothing here touches `estimates`: receipts keep the hash they
// were saved against, and the widening happens in the query.
//
// The user links versions; the name is only the hint. `linkOffer` computes
// whether the one-line offer should appear on load, and `link` records the
// person's answer. Nothing links by itself.

export class DocumentsStore {
  readonly #root: Statement
  readonly #versions: Statement
  readonly #known: Statement
  readonly #candidate: Statement
  readonly #count: Statement
  readonly #link: Statement
  readonly #now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.#now = now
    this.#root = db.prepare('SELECT document_hash FROM document_versions WHERE content_hash = ?')
    this.#versions = db.prepare(
      'SELECT content_hash FROM document_versions WHERE document_hash = ? ORDER BY linked_at, content_hash'
    )
    // "Known" means some record already speaks for this hash: a receipt saved
    // against it, or a link either way. Only an unknown hash gets the offer.
    this.#known = db.prepare(`
      SELECT 1 WHERE EXISTS (SELECT 1 FROM estimates WHERE content_hash = @hash)
                  OR EXISTS (SELECT 1 FROM document_versions WHERE content_hash = @hash)
                  OR EXISTS (SELECT 1 FROM document_versions WHERE document_hash = @hash)
    `)
    // The most recently saved receipt under this file name, resolved to its
    // document. Newest wins when several documents share the name: the one
    // someone worked on last is the likeliest "earlier version". Newest by
    // id, for the reason `EstimatesStore` gives.
    this.#candidate = db.prepare(`
      SELECT COALESCE(v.document_hash, e.content_hash) AS document_hash
      FROM estimates e
      LEFT JOIN document_versions v ON v.content_hash = e.content_hash
      WHERE e.file_name = @fileName AND e.content_hash <> '' AND e.content_hash <> @hash
      ORDER BY e.id DESC
      LIMIT 1
    `)
    this.#count = db.prepare(`
      SELECT COUNT(*) AS n FROM estimates
      WHERE content_hash = @root
         OR content_hash IN (SELECT content_hash FROM document_versions WHERE document_hash = @root)
    `)
    this.#link = db.prepare(`
      INSERT INTO document_versions (content_hash, document_hash, linked_at)
      VALUES (@contentHash, @documentHash, @linkedAt)
      ON CONFLICT(content_hash) DO UPDATE SET document_hash = excluded.document_hash,
                                             linked_at = excluded.linked_at
    `)
  }

  /** The document a hash belongs to — its root, or itself when unlinked. */
  documentOf(contentHash: string): string {
    const row = this.#root.get(contentHash) as { document_hash: string } | undefined
    return row?.document_hash ?? contentHash
  }

  /** Every hash in a hash's document, root first. */
  versionsOf(contentHash: string): string[] {
    const root = this.documentOf(contentHash)
    const linked = (this.#versions.all(root) as { content_hash: string }[]).map((r) => r.content_hash)
    return [root, ...linked]
  }

  /**
   * Whether to offer linking a just-loaded file to an earlier document
   * (ADR-0034 §3): only when `contentHash` is unknown AND another document
   * holds receipts under the same file name. Null means no offer.
   */
  linkOffer(contentHash: string, fileName: string): LinkOffer | null {
    // An empty hash matches nothing, and is never anyone's document.
    if (contentHash === '') return null
    if (this.#known.get({ hash: contentHash }) !== undefined) return null
    const candidate = this.#candidate.get({ fileName, hash: contentHash }) as
      | { document_hash: string }
      | undefined
    if (candidate === undefined) return null
    const { n } = this.#count.get({ root: candidate.document_hash }) as { n: number }
    return { contentHash, documentHash: candidate.document_hash, fileName, count: n }
  }

  /**
   * Record that `contentHash` is a later version of `documentHash`'s document.
   * Resolves the target through to its root first, so the table stays one
   * hop deep. Linking a hash to its own document is a no-op.
   */
  link(contentHash: string, documentHash: string): void {
    if (contentHash === '' || documentHash === '') {
      throw new Error('an empty hash is never a document version')
    }
    const root = this.documentOf(documentHash)
    if (root === contentHash) return
    this.#link.run({ contentHash, documentHash: root, linkedAt: this.#now() })
  }
}
