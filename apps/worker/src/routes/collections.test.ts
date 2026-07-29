import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import collectionsApp, {
  countCollectionNodes,
  isManagedAutoNodeCollectionNotes,
  validateCollectionWithGroupInput,
  validateCollectionWrite,
} from './collections'
import type { NodeCollection, ProxyNode } from '@uni-conf/types'

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
      enabled: false,
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
      enabled: false,
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

  it('validates the atomic node-group envelope', () => {
    expect(validateCollectionWithGroupInput({
      collection: { name: 'US Pool' },
      groupType: 'url-test',
    })).toEqual({
      valid: true,
      collection: { name: 'US Pool' },
      groupType: 'url-test',
    })
    expect(validateCollectionWithGroupInput({
      collection: { name: 'US Pool' },
      groupType: 'load-balance',
    })).toEqual({
      valid: false,
      error: 'groupType must be select, url-test, or fallback',
    })
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
      error: 'system node group marker is reserved',
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

  it('counts transformed nodes within the collection scope', () => {
    const nodes = [
      makeNode('node-1', 'source-1', 'HK 01'),
      makeNode('node-2', 'source-1', 'HK 01'),
      makeNode('node-3', 'source-2', 'JP 01'),
    ]
    const collection: NodeCollection = {
      id: 'collection-1',
      name: 'Source 1',
      sourceIds: ['source-1'],
      nodeIds: [],
      filters: [],
      renames: [],
      dedup: 'name',
      sort: 'name',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(countCollectionNodes(nodes, collection)).toBe(1)
  })

  it('initializes zero-setup defaults after creating a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'US Pool' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default')
  })

  it('creates a collection and its dedicated group in one database batch', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/with-group', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        collection: { name: 'JP Auto', enabled: true },
        groupType: 'url-test',
      }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(readCollectionDb(db).batch).toHaveBeenCalledOnce()
    expect(readCollectionDb(db).batch.mock.calls[0]?.[0]).toHaveLength(2)
    const body = await response.json() as {
      data: { collection: { id: string; name: string }; group: { collectionIds: string[]; type: string } };
    }
    expect(body.data.collection.name).toBe('JP Auto')
    expect(body.data.group.collectionIds).toEqual([body.data.collection.id])
    expect(body.data.group.type).toBe('url-test')
  })

  it('updates the collection and dedicated group in one database batch', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/collection-1/with-group', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        collection: { name: 'US Fallback', enabled: false },
        groupType: 'fallback',
      }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(readCollectionDb(db).batch).toHaveBeenCalledOnce()
    expect(readCollectionDb(db).batch.mock.calls[0]?.[0]).toHaveLength(2)
    const body = await response.json() as {
      data: { collection: { name: string; enabled: boolean }; group: { name: string; type: string; enabled: boolean } };
    }
    expect(body.data.collection).toMatchObject({ name: 'US Fallback', enabled: false })
    expect(body.data.group).toMatchObject({ name: 'US Fallback', type: 'fallback', enabled: false })
  })

  it('initializes zero-setup defaults after updating a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/collection-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default')
  })

  it('initializes zero-setup defaults after deleting a collection', async () => {
    const db = createCollectionRouteMockDb()

    const response = await collectionsApp.request('/collection-1', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(200)
    expect(readCollectionDb(db).groups.size).toBe(0)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default')
  })

  it('rejects deleting a collection referenced by a multi-collection policy group', async () => {
    const db = createCollectionRouteMockDb()
    const state = readCollectionDb(db)
    state.groups.set('combined-group', {
      ...groupRow('combined-group', 'Combined', 'collection-1'),
      collection_ids: '["collection-1","collection-2"]',
    })

    const response = await collectionsApp.request('/collection-1', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'node group is referenced by policy group: Combined',
      code: 'resource_in_use',
      details: {
        dependencies: [{
          type: 'policy-group',
          id: 'combined-group',
          name: 'Combined',
          remediation: { target: 'groups', id: 'combined-group' },
        }],
      },
    })
    expect(state.collections.has('collection-1')).toBe(true)
    expect(state.batch).not.toHaveBeenCalled()
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })
})

function makeNode(id: string, sourceId: string, name: string): ProxyNode {
  return {
    id,
    sourceId,
    name,
    protocol: 'ss',
    server: `${id}.example.com`,
    port: 443,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: {
      protocol: 'ss',
      server: `${id}.example.com`,
      port: 443,
      password: 'secret',
      extra: { method: 'aes-128-gcm' },
    },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function createCollectionRouteMockDb(): D1Database {
  const stored = new Map<string, Record<string, unknown>>([
    ['collection-1', collectionRow('collection-1', 'US Pool')],
  ])
  const groups = new Map<string, Record<string, unknown>>([
    ['group-1', groupRow('group-1', 'US Pool', 'collection-1')],
  ])

  const batch = vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => {
    for (const statement of statements) await statement.run()
    return []
  })
  const db = {
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
          if (sql.includes('SELECT * FROM groups WHERE is_builtin = 0 AND collection_ids = ?')) {
            return [...groups.values()].find(row => row.collection_ids === args[0]) ?? null
          }
          if (sql.includes('SELECT * FROM groups WHERE id = ?')) {
            return groups.get(String(args[0])) ?? null
          }
          return null
        },
        all: async () => {
          if (sql.includes('SELECT id, name, is_builtin, collection_ids FROM groups')) {
            return { results: [...groups.values()] }
          }
          if (sql.includes('SELECT id, name, type, collection_ids, group_ids, enabled, is_builtin FROM groups')) {
            return { results: [...groups.values()] }
          }
          if (sql.includes('SELECT id, name, include_collection_ids FROM export_configs')) {
            return { results: [] }
          }
          return { results: sql.includes('SELECT * FROM collections') ? [...stored.values()] : [] }
        },
        run: async () => {
          if (sql.includes('INSERT INTO collections')) {
            stored.set(String(args[0]), collectionRow(String(args[0]), String(args[1]), {
              enabled: Number(args[9]),
              notes: args[10],
            }))
          }
          if (sql.includes('UPDATE collections SET')) {
            const id = String(args[11])
            const existing = stored.get(id) ?? collectionRow(id, 'US Pool')
            stored.set(id, { ...existing, name: args[0], enabled: args[8], notes: args[9], updated_at: args[10] })
          }
          if (sql.includes('INSERT INTO groups')) {
            groups.set(String(args[0]), groupRow(String(args[0]), String(args[1]), JSON.parse(String(args[3]))[0], {
              type: String(args[2]),
              enabled: Number(args[10]),
              sort_order: Number(args[11]),
            }))
          }
          if (sql.includes('UPDATE groups SET name')) {
            const id = String(args[5])
            const existing = groups.get(id) ?? groupRow(id, String(args[0]), JSON.parse(String(args[2]))[0])
            groups.set(id, {
              ...existing,
              name: args[0],
              type: args[1],
              collection_ids: args[2],
              enabled: args[3],
              updated_at: args[4],
            })
          }
          if (sql.includes('DELETE FROM groups')) {
            for (const [id, row] of groups) {
              if (row.collection_ids === args[1]) groups.delete(id)
            }
          }
          if (sql.includes('DELETE FROM collections WHERE id = ?')) {
            stored.delete(String(args[0]))
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => sql.includes('SELECT MAX(sort_order)')
        ? { max_order: Math.max(-1, ...[...groups.values()].map(row => Number(row.sort_order))) }
        : null,
      all: async () => {
        if (sql.includes('SELECT id, name, is_builtin, collection_ids FROM groups')) {
          return {
            results: [...groups.values()].map(row => ({
              id: row.id,
              name: row.name,
              is_builtin: row.is_builtin,
              collection_ids: row.collection_ids,
            })),
          }
        }
        if (sql.includes('SELECT id, name, type, collection_ids, group_ids, enabled, is_builtin FROM groups')) {
          return { results: [...groups.values()] }
        }
        if (sql.includes('SELECT id, name, include_collection_ids FROM export_configs')) {
          return { results: [] }
        }
        return { results: sql.includes('SELECT * FROM collections') ? [...stored.values()] : [] }
      },
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch,
    __collections: stored,
    __groups: groups,
  }
  return db as unknown as D1Database
}

function readCollectionDb(db: D1Database): {
  batch: ReturnType<typeof vi.fn>;
  collections: Map<string, Record<string, unknown>>;
  groups: Map<string, Record<string, unknown>>;
} {
  const state = db as unknown as {
    batch: ReturnType<typeof vi.fn>;
    __collections: Map<string, Record<string, unknown>>;
    __groups: Map<string, Record<string, unknown>>;
  }
  return { batch: state.batch, collections: state.__collections, groups: state.__groups }
}

function collectionRow(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...overrides,
  }
}

function groupRow(
  id: string,
  name: string,
  collectionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    type: 'url-test',
    collection_ids: JSON.stringify([collectionId]),
    group_ids: '[]',
    builtins: '[]',
    test_url: null,
    interval: 300,
    tolerance: 50,
    lazy: 1,
    enabled: 1,
    sort_order: 1,
    is_builtin: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
