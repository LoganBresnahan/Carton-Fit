import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { openDatabase } from '../src/main/db/open'
import { ConfigurationsStore } from '../src/main/db/configurations'
import { EstimatesStore } from '../src/main/db/estimates'
import { DocumentsStore } from '../src/main/db/documents'
import { CustomersStore } from '../src/main/db/customers'

function freshDb(): Database {
  return openDatabase(join(mkdtempSync(join(tmpdir(), 'pe-db-')), 'estimator.db')).db
}

/** A stand-in for the renderer's PackingSettings — the stores treat it as opaque JSON. */
const SETTINGS = {
  mode: 'fit-check',
  tier: 'fast',
  boxDimsMm: [304.8, 304.8, 304.8],
  maxWeightG: 15876,
  unitSystem: 'imperial'
}

describe('ConfigurationsStore', () => {
  it('round-trips a preset with its structure intact', () => {
    const db = freshDb()
    try {
      const store = new ConfigurationsStore(db, () => 1000)
      store.save('Standard carton', SETTINGS)

      const loaded = store.get('Standard carton')
      expect(loaded?.settings).toEqual(SETTINGS)
      // Nested arrays survive the JSON boundary — dims are the thing most
      // likely to be quietly mangled.
      expect((loaded?.settings as typeof SETTINGS).boxDimsMm).toEqual([304.8, 304.8, 304.8])
      expect(loaded?.createdAt).toBe(1000)
      expect(loaded?.updatedAt).toBe(1000)
    } finally {
      db.close()
    }
  })

  it('saving an existing name overwrites it and keeps one row', () => {
    const db = freshDb()
    try {
      let clock = 1000
      const store = new ConfigurationsStore(db, () => clock)
      store.save('Standard carton', SETTINGS)
      clock = 2000
      store.save('Standard carton', { ...SETTINGS, maxWeightG: 999 })

      expect(store.list()).toHaveLength(1)
      const loaded = store.get('Standard carton')
      expect((loaded?.settings as typeof SETTINGS).maxWeightG).toBe(999)
      // Creation time is history; only updated_at moves.
      expect(loaded?.createdAt).toBe(1000)
      expect(loaded?.updatedAt).toBe(2000)
    } finally {
      db.close()
    }
  })

  it('lists presets alphabetically without their settings blobs', () => {
    const db = freshDb()
    try {
      const store = new ConfigurationsStore(db)
      store.save('Zebra', SETTINGS)
      store.save('alpha', SETTINGS)
      store.save('Mid', SETTINGS)

      expect(store.list().map((c) => c.name)).toEqual(['Mid', 'Zebra', 'alpha'])
      expect(store.list()[0]).not.toHaveProperty('settings')
    } finally {
      db.close()
    }
  })

  it('trims names and rejects blank ones', () => {
    const db = freshDb()
    try {
      const store = new ConfigurationsStore(db)
      store.save('  padded  ', SETTINGS)
      expect(store.get('padded')).not.toBeNull()

      expect(() => store.save('   ', SETTINGS)).toThrow(/name/i)
      expect(() => store.save('', SETTINGS)).toThrow(/name/i)
    } finally {
      db.close()
    }
  })

  it('reports whether a removal actually removed something', () => {
    const db = freshDb()
    try {
      const store = new ConfigurationsStore(db)
      store.save('temp', SETTINGS)
      expect(store.remove('temp')).toBe(true)
      expect(store.remove('temp')).toBe(false)
      expect(store.get('temp')).toBeNull()
    } finally {
      db.close()
    }
  })
})

describe('EstimatesStore', () => {
  const entry = (over: Partial<Parameters<EstimatesStore['record']>[0]> = {}) => ({
    fileName: 'bracket.stp',
    contentHash: 'abc123',
    settings: SETTINGS,
    result: { count: 42, binding: 'geometry' },
    ...over
  })

  it('records an estimate and reads it back whole', () => {
    const db = freshDb()
    try {
      const store = new EstimatesStore(db, () => 5000)
      const id = store.record(entry())
      expect(id).toBeGreaterThan(0)

      const [row] = store.recent()
      expect(row.id).toBe(id)
      expect(row.fileName).toBe('bracket.stp')
      expect(row.result).toEqual({ count: 42, binding: 'geometry' })
      expect(row.createdAt).toBe(5000)
    } finally {
      db.close()
    }
  })

  it('keeps every estimate — the same part packed twice is two rows', () => {
    const db = freshDb()
    try {
      const store = new EstimatesStore(db, () => 5000)
      store.record(entry())
      store.record(entry())
      // VISION: every estimate is recorded. No upsert, no dedupe.
      expect(store.recent()).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('orders same-millisecond estimates deterministically, newest first', () => {
    const db = freshDb()
    try {
      // A frozen clock is the realistic case for a burst, and the reason
      // `recent` tiebreaks on id: without it this order would be arbitrary.
      const store = new EstimatesStore(db, () => 7000)
      const first = store.record(entry({ fileName: 'first.stp' }))
      const second = store.record(entry({ fileName: 'second.stp' }))
      const third = store.record(entry({ fileName: 'third.stp' }))

      expect(store.recent().map((r) => r.id)).toEqual([third, second, first])
    } finally {
      db.close()
    }
  })

  it('orders across timestamps newest first and honours the limit', () => {
    const db = freshDb()
    try {
      let clock = 1000
      const store = new EstimatesStore(db, () => clock)
      store.record(entry({ fileName: 'oldest.stp' }))
      clock = 2000
      store.record(entry({ fileName: 'middle.stp' }))
      clock = 3000
      store.record(entry({ fileName: 'newest.stp' }))

      expect(store.recent().map((r) => r.fileName)).toEqual([
        'newest.stp',
        'middle.stp',
        'oldest.stp'
      ])
      expect(store.recent(2).map((r) => r.fileName)).toEqual(['newest.stp', 'middle.stp'])
    } finally {
      db.close()
    }
  })

  it('finds history for one part by content hash, ignoring the file name', () => {
    const db = freshDb()
    try {
      let clock = 1000
      const store = new EstimatesStore(db, () => clock)
      store.record(entry({ contentHash: 'same', fileName: 'bracket.stp' }))
      clock = 2000
      // Renamed on disk, same geometry — history should still find it.
      store.record(entry({ contentHash: 'same', fileName: 'bracket-v2.stp' }))
      store.record(entry({ contentHash: 'different', fileName: 'other.stp' }))

      const history = store.forContent('same')
      expect(history.map((r) => r.fileName)).toEqual(['bracket-v2.stp', 'bracket.stp'])
      expect(store.forContent('nothing-matches')).toEqual([])
    } finally {
      db.close()
    }
  })
})

describe('EstimatesStore ordering does not trust the clock', () => {
  it('a save stamped in the future still lists in the order it was saved', () => {
    // 2026-09-08: a WSL2 machine on the tsc clocksource read 110 s ahead for
    // one call. The row's shown time was wrong; its place in the list must not
    // be.
    const db = freshDb()
    try {
      const stamps = [1000, 111_000, 2000]
      const store = new EstimatesStore(db, () => stamps.shift() ?? 0)
      const entry = { fileName: 'a.stp', contentHash: 'h', settings: SETTINGS, result: {} }
      const first = store.record(entry)
      const skewed = store.record(entry)
      const third = store.record(entry)
      expect(store.recent().map((r) => r.id)).toEqual([third, skewed, first])
      expect(store.forContent('h').map((r) => r.id)).toEqual([third, skewed, first])
      expect(store.forDocument('h').map((r) => r.id)).toEqual([third, skewed, first])
    } finally {
      db.close()
    }
  })
})

describe('EstimatesStore.remove (ADR-0034 §4)', () => {
  it('removes exactly the row asked for and reports whether one went', () => {
    const db = freshDb()
    try {
      const store = new EstimatesStore(db, () => 1)
      const entry = { fileName: 'a.stp', contentHash: 'h', settings: SETTINGS, result: {} }
      const keep = store.record(entry)
      const gone = store.record(entry)
      expect(store.remove(gone)).toBe(true)
      expect(store.remove(gone)).toBe(false)
      expect(store.recent().map((r) => r.id)).toEqual([keep])
    } finally {
      db.close()
    }
  })
})

// Document versions (ADR-0034 §3): a document is a set of hashes, the user
// links them, the name is only the hint, and no receipt is ever rewritten.
describe('DocumentsStore', () => {
  const receipt = (fileName: string, contentHash: string) => ({
    fileName,
    contentHash,
    settings: SETTINGS,
    result: { count: 1 }
  })

  it('an unlinked hash is its own document', () => {
    const db = freshDb()
    try {
      const docs = new DocumentsStore(db)
      expect(docs.documentOf('hash-a')).toBe('hash-a')
      expect(docs.versionsOf('hash-a')).toEqual(['hash-a'])
    } finally {
      db.close()
    }
  })

  it('linking widens the scope query to the set, and rows keep their own hash', () => {
    const db = freshDb()
    try {
      let clock = 1
      const estimates = new EstimatesStore(db, () => clock++)
      const docs = new DocumentsStore(db, () => 100)
      estimates.record(receipt('as1.stp', 'rev-a'))
      estimates.record(receipt('as1.stp', 'rev-a'))
      estimates.record(receipt('other.stp', 'unrelated'))
      // Before the link: rev-b sees nothing of rev-a's history.
      expect(estimates.forDocument('rev-b')).toEqual([])

      docs.link('rev-b', 'rev-a')
      estimates.record(receipt('as1.stp', 'rev-b'))

      // Either hash reaches the whole set, newest first…
      expect(estimates.forDocument('rev-b').map((r) => r.contentHash)).toEqual([
        'rev-b',
        'rev-a',
        'rev-a'
      ])
      expect(estimates.forDocument('rev-a').map((r) => r.contentHash)).toEqual([
        'rev-b',
        'rev-a',
        'rev-a'
      ])
      // …the exact-hash query is untouched…
      expect(estimates.forContent('rev-a')).toHaveLength(2)
      // …and the unrelated part stays out.
      expect(estimates.forDocument('unrelated')).toHaveLength(1)
      expect(docs.versionsOf('rev-b')).toEqual(['rev-a', 'rev-b'])
    } finally {
      db.close()
    }
  })

  it('linking to a version resolves to the root, so the table stays one hop deep', () => {
    const db = freshDb()
    try {
      const docs = new DocumentsStore(db)
      docs.link('rev-b', 'rev-a')
      docs.link('rev-c', 'rev-b')
      expect(docs.documentOf('rev-c')).toBe('rev-a')
      expect(docs.versionsOf('rev-a')).toEqual(['rev-a', 'rev-b', 'rev-c'])
      // Linking a hash to its own document changes nothing.
      docs.link('rev-a', 'rev-c')
      expect(docs.documentOf('rev-a')).toBe('rev-a')
    } finally {
      db.close()
    }
  })

  it('refuses an empty hash on either side', () => {
    const db = freshDb()
    try {
      const docs = new DocumentsStore(db)
      expect(() => docs.link('', 'rev-a')).toThrow(/empty hash/)
      expect(() => docs.link('rev-a', '')).toThrow(/empty hash/)
      expect(docs.linkOffer('', 'as1.stp')).toBeNull()
      expect(new EstimatesStore(db).forDocument('')).toEqual([])
    } finally {
      db.close()
    }
  })

  describe('linkOffer', () => {
    it('offers only for an unknown hash whose file name another document has receipts under', () => {
      const db = freshDb()
      try {
        const estimates = new EstimatesStore(db, () => 1)
        const docs = new DocumentsStore(db)
        estimates.record(receipt('as1.stp', 'rev-a'))
        estimates.record(receipt('as1.stp', 'rev-a'))
        estimates.record(receipt('as1.stp', 'rev-a'))

        expect(docs.linkOffer('rev-b', 'as1.stp')).toEqual({
          contentHash: 'rev-b',
          documentHash: 'rev-a',
          fileName: 'as1.stp',
          count: 3
        })
        // A different name is not a hint.
        expect(docs.linkOffer('rev-b', 'renamed.stp')).toBeNull()
        // A hash that already has a receipt is known — no offer.
        expect(docs.linkOffer('rev-a', 'as1.stp')).toBeNull()
      } finally {
        db.close()
      }
    })

    it('a linked hash is known, and the count spans the whole document', () => {
      const db = freshDb()
      try {
        const estimates = new EstimatesStore(db, () => 1)
        const docs = new DocumentsStore(db)
        estimates.record(receipt('as1.stp', 'rev-a'))
        docs.link('rev-b', 'rev-a')
        estimates.record(receipt('as1.stp', 'rev-b'))

        // rev-b was linked, so loading it again asks nothing…
        expect(docs.linkOffer('rev-b', 'as1.stp')).toBeNull()
        // …and a third revision is offered the root, counting both versions.
        expect(docs.linkOffer('rev-c', 'as1.stp')).toEqual({
          contentHash: 'rev-c',
          documentHash: 'rev-a',
          fileName: 'as1.stp',
          count: 2
        })
      } finally {
        db.close()
      }
    })

    it('when two documents share the name, the one saved to last is offered', () => {
      const db = freshDb()
      try {
        let clock = 1
        const estimates = new EstimatesStore(db, () => clock++)
        const docs = new DocumentsStore(db)
        estimates.record(receipt('plate.stp', 'old-plate'))
        estimates.record(receipt('plate.stp', 'new-plate'))
        expect(docs.linkOffer('newer-plate', 'plate.stp')?.documentHash).toBe('new-plate')
      } finally {
        db.close()
      }
    })

    it('rows saved with an empty hash never make an offer', () => {
      const db = freshDb()
      try {
        const estimates = new EstimatesStore(db, () => 1)
        const docs = new DocumentsStore(db)
        estimates.record(receipt('as1.stp', ''))
        expect(docs.linkOffer('rev-b', 'as1.stp')).toBeNull()
      } finally {
        db.close()
      }
    })
  })
})

// Customers (ADR-0035): a name and an id; a label on presets and receipts;
// every list is house-plus-active or everything.
describe('CustomersStore', () => {
  it('creates, lists alphabetically, and refuses a blank or duplicate name', () => {
    const db = freshDb()
    try {
      const customers = new CustomersStore(db, () => 7)
      const beta = customers.create('  Beta  ')
      const acme = customers.create('acme')
      expect(beta).toEqual({ id: beta.id, name: 'Beta', createdAt: 7 })
      expect(customers.list().map((c) => c.name)).toEqual(['acme', 'Beta'])
      expect(customers.byId(acme.id)?.name).toBe('acme')
      expect(customers.byId(999)).toBeNull()
      expect(() => customers.create('   ')).toThrow(/needs a name/)
      expect(() => customers.create('Beta')).toThrow(/UNIQUE/)
    } finally {
      db.close()
    }
  })
})

describe('the customer filter (ADR-0035 §3)', () => {
  const entry = (contentHash: string, customerId: number | null) => ({
    fileName: 'a.stp',
    contentHash,
    settings: SETTINGS,
    result: {},
    customerId
  })

  it('presets: house plus the active customer, or everything', () => {
    const db = freshDb()
    try {
      const customers = new CustomersStore(db)
      const acme = customers.create('Acme').id
      const beta = customers.create('Beta').id
      const presets = new ConfigurationsStore(db)
      presets.save('House box', SETTINGS)
      presets.save('Acme box', SETTINGS, acme)
      presets.save('Beta box', SETTINGS, beta)

      const names = (rows: { name: string }[]) => rows.map((r) => r.name)
      expect(names(presets.list())).toEqual(['Acme box', 'Beta box', 'House box'])
      expect(names(presets.list({ activeId: acme }))).toEqual(['Acme box', 'House box'])
      // House active: house only — house IS the active customer then.
      expect(names(presets.list({ activeId: null }))).toEqual(['House box'])
      expect(presets.get('Acme box')?.customerId).toBe(acme)
      expect(presets.get('House box')?.customerId).toBeNull()
    } finally {
      db.close()
    }
  })

  it("a preset's customer can change; re-saving a name moves it", () => {
    const db = freshDb()
    try {
      const acme = new CustomersStore(db).create('Acme').id
      const presets = new ConfigurationsStore(db)
      presets.save('Box', SETTINGS)
      expect(presets.setCustomer('Box', acme)).toBe(true)
      expect(presets.get('Box')?.customerId).toBe(acme)
      presets.save('Box', SETTINGS, null)
      expect(presets.get('Box')?.customerId).toBeNull()
      expect(presets.setCustomer('no such', acme)).toBe(false)
    } finally {
      db.close()
    }
  })

  it('receipts: every list — recent, by hash, by document — takes the same filter', () => {
    const db = freshDb()
    try {
      const acme = new CustomersStore(db).create('Acme').id
      const beta = new CustomersStore(db).create('Beta').id
      const estimates = new EstimatesStore(db, () => 1)
      const house = estimates.record(entry('h', null))
      const forAcme = estimates.record(entry('h', acme))
      const forBeta = estimates.record(entry('h', beta))
      new DocumentsStore(db).link('h2', 'h')
      const later = estimates.record(entry('h2', acme))

      const ids = (rows: { id: number }[]) => rows.map((r) => r.id)
      expect(ids(estimates.recent())).toEqual([later, forBeta, forAcme, house])
      expect(ids(estimates.recent(50, { activeId: acme }))).toEqual([later, forAcme, house])
      expect(ids(estimates.recent(50, { activeId: null }))).toEqual([house])
      expect(ids(estimates.forContent('h', 50, { activeId: beta }))).toEqual([forBeta, house])
      expect(ids(estimates.forDocument('h', 50, { activeId: acme }))).toEqual([
        later,
        forAcme,
        house
      ])
      // The tag was set at save and is on the row; there is no call to change it.
      expect(estimates.byId(forAcme)?.customerId).toBe(acme)
      expect(estimates.byId(house)?.customerId).toBeNull()
    } finally {
      db.close()
    }
  })
})
