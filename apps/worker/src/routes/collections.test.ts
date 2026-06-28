import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import collectionsApp, { isManagedAutoNodeCollectionNotes, validateCollectionWrite } from './collections'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}))

describe('collections route helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes create payloads with defaults', () => {
    expect(validateCollectionWrite({
      name: '  US Pool  ',
      sourceIds: [' source-1 ', 'source-1'],
      filters: [{
        id: ' country ',
        field: 'countryCode',
        operator: 'equals',
        value: ' US ',
        enabled: true,
      }],
      renames: [{
        id: 'strip',
        type: 'strip_emoji',
        enabled: true,
        order: 0,
      }],
    }, { create: true })).toEqual({
      valid: true,
      name: 'US Pool',
      sourceIds: ['source-1'],
      nodeIds: undefined,
      filters: [{
        id: 'country',
        field: 'countryCode',
        operator: 'equals',
        value: 'US',
        enabled: true,
      }],
      renames: [{
        id: 'strip',
        type: 'strip_emoji',
        pattern: undefined,
        replacement: undefined,
        enabled: true,
        order: 0,
      }],
      dedup: 'name',
      sort: 'country',
      sortCountryOrder: undefined,
      enabled: true,
      notes: undefined,
    })
  })

  it('normalizes list filter values', () => {
    expect(validateCollectionWrite({
      filters: [{
        id: 'tags',
        field: 'tag',
        operator: 'in',
        value: ' streaming, unlock, streaming ',
        enabled: true,
      }],
    }, { create: false })).toEqual(expect.objectContaining({
      valid: true,
      filters: [{
        id: 'tags',
        field: 'tag',
        operator: 'in',
        value: ['streaming', 'unlock'],
        enabled: true,
      }],
    }))
  })

  it('rejects malformed collection payloads', () => {
    expect(validateCollectionWrite({ name: ' ' }, { create: true })).toEqual({
      valid: false,
      error: 'name is required',
    })
    expect(validateCollectionWrite({ sourceIds: ['source-1', ''] }, { create: false })).toEqual({
      valid: false,
      error: 'sourceIds must only contain non-empty strings',
    })
    expect(validateCollectionWrite({ dedup: 'server' as never }, { create: false })).toEqual({
      valid: false,
      error: 'invalid dedup strategy',
    })
    expect(validateCollectionWrite({ sort: 'latency' as never }, { create: false })).toEqual({
      valid: false,
      error: 'invalid sort strategy',
    })
    expect(validateCollectionWrite({ name: 'US Auto', notes: '[uni-conf:auto-node-group] country:US:url-test' }, { create: true })).toEqual({
      valid: false,
      error: 'generated node group marker is reserved',
    })
  })

  it('rejects invalid filters and rename regexes', () => {
    expect(validateCollectionWrite({
      filters: [{ id: 'bad', field: 'name', operator: 'starts_with' as never, value: 'HK', enabled: true }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid filter operator at index 0',
    })
    expect(validateCollectionWrite({
      filters: [{ id: 'bad', field: 'name', operator: 'regex', value: '(', enabled: true }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid filter regex at index 0',
    })
    expect(validateCollectionWrite({
      renames: [{ id: 'bad', type: 'regex', pattern: '(', enabled: true, order: 0 }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid rename regex at index 0',
    })
  })

  it('identifies managed auto node group notes', () => {
    expect(isManagedAutoNodeCollectionNotes('[uni-conf:auto-node-group] country:US:url-test')).toBe(true)
    expect(isManagedAutoNodeCollectionNotes('  [uni-conf:auto-node-group] country:HK:fallback')).toBe(true)
    expect(isManagedAutoNodeCollectionNotes('[uni-conf:source-node-group] source:group')).toBe(false)
    expect(isManagedAutoNodeCollectionNotes(null)).toBe(false)
  })

  it('initializes zero-setup defaults before listing collections', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('initializes zero-setup defaults after creating a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'US Pool' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('initializes zero-setup defaults after updating a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/collection-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('initializes zero-setup defaults after deleting a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/collection-1', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })
})

function createCollectionRouteMockDb(): D1Database {
  const stored = new Map<string, Record<string, unknown>>([
    ['collection-1', collectionRow('collection-1', 'US Pool')],
  ])

  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM collections WHERE id = ?')) {
            return stored.get(String(args[0])) ?? null
          }
          if (sql.includes('SELECT id, notes FROM collections WHERE id = ?')) {
            const row = stored.get(String(args[0]))
            return row ? { id: row.id, notes: row.notes } : null
          }
          return null
        },
        all: async () => ({ results: sql.includes('SELECT * FROM collections') ? [...stored.values()] : [] }),
        run: async () => {
          if (sql.includes('INSERT INTO collections')) {
            stored.set(String(args[0]), collectionRow(String(args[0]), String(args[1])))
          }
          if (sql.includes('UPDATE collections SET')) {
            const id = String(args[11])
            const existing = stored.get(id) ?? collectionRow(id, 'US Pool')
            stored.set(id, { ...existing, enabled: args[9], updated_at: args[10] })
          }
          if (sql.includes('DELETE FROM collections WHERE id = ?')) {
            stored.delete(String(args[0]))
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: sql.includes('SELECT * FROM collections') ? [...stored.values()] : [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database
}

function collectionRow(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    source_ids: '[]',
    node_ids: '[]',
    filters: '[]',
    renames: '[]',
    dedup: 'name',
    sort: 'country',
    sort_country_order: '[]',
    enabled: 1,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}
