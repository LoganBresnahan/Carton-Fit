import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { openDatabase } from '../src/main/db/open'
import { ConfigurationsStore } from '../src/main/db/configurations'
import { EstimatesStore } from '../src/main/db/estimates'

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
