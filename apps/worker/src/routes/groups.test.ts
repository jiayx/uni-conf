import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import groupsApp, { validateGroupReorderInput, validateGroupWrite } from './groups'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}))

describe('groups route helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes create payloads for custom groups', () => {
    expect(validateGroupWrite({
      name: '  AI Backup  ',
      type: 'select',
      groupIds: [' builtin-proxy ', 'builtin-proxy', 'builtin-auto-select'],
      builtins: ['DIRECT', 'DIRECT'],
      interval: 300,
      tolerance: 150,
    }, { create: true, isBuiltin: false })).toEqual({
      valid: true,
      name: 'AI Backup',
      type: 'select',
      collectionIds: undefined,
      groupIds: ['builtin-proxy', 'builtin-auto-select'],
      builtins: ['DIRECT'],
      testUrl: undefined,
      interval: 300,
      tolerance: 150,
      lazy: true,
      enabled: true,
    })
  })

  it('rejects invalid group shapes', () => {
    expect(validateGroupWrite({ name: 'Bad', type: 'random' as never }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'invalid group type',
    })
    expect(validateGroupWrite({ name: 'Bad', type: 'direct' }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'DIRECT and REJECT are built-in foundation outlets',
    })
    expect(validateGroupWrite({ groupIds: ['group-1', ''] }, { create: false, id: 'group-2', isBuiltin: false })).toEqual({
      valid: false,
      error: 'groupIds must only contain non-empty strings',
    })
    expect(validateGroupWrite({ builtins: ['PROXY' as never] }, { create: false, id: 'group-2', isBuiltin: false })).toEqual({
      valid: false,
      error: 'builtins must only contain DIRECT or REJECT',
    })
    expect(validateGroupWrite({ groupIds: ['group-1'] }, { create: false, id: 'group-1', isBuiltin: false })).toEqual({
      valid: false,
      error: 'groupIds cannot include the group itself',
    })
    expect(validateGroupWrite({ name: ' AI ', type: 'select' }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'custom group name conflicts with a built-in policy group',
    })
    expect(validateGroupWrite({ name: 'direct' }, { create: false, id: 'custom-1', isBuiltin: false })).toEqual({
      valid: false,
      error: 'custom group name conflicts with a built-in policy group',
    })
  })

  it('allows built-in foundation types only for built-in group maintenance', () => {
    expect(validateGroupWrite({ name: 'REJECT', type: 'reject' }, { create: false, id: 'builtin-reject', isBuiltin: true })).toEqual({
      valid: true,
      name: 'REJECT',
      type: 'reject',
      collectionIds: undefined,
      groupIds: undefined,
      builtins: undefined,
      testUrl: undefined,
      interval: undefined,
      tolerance: undefined,
      lazy: undefined,
      enabled: undefined,
    })
  })

  it('validates reorder ids and rejects duplicates', () => {
    expect(validateGroupReorderInput({ ids: [' custom-downloads ', 'builtin-ai'] })).toEqual({
      valid: true,
      ids: ['custom-downloads', 'builtin-ai'],
    })
    expect(validateGroupReorderInput({ ids: ['custom-downloads', 'custom-downloads'] })).toEqual({
      valid: false,
      error: 'group ids must not contain duplicates',
    })
    expect(validateGroupReorderInput({ ids: ['custom-downloads', ''] })).toEqual({
      valid: false,
      error: 'every group id must be a non-empty string',
    })
  })

  it('initializes zero-setup defaults after creating a group', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Downloads', type: 'select' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('initializes zero-setup defaults after updating a group', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/custom-downloads', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('rejects missing nested groups before creating a custom group', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Broken', type: 'select', groupIds: ['missing-group'] }),
    }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('references a missing group: missing-group'),
    })
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('rejects missing node-group collections before creating a policy group', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Broken Collection',
        type: 'select',
        collectionIds: ['missing-collection'],
      }),
    }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'group references a missing node group: missing-collection',
    })
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('rejects an update that would create an indirect group cycle', async () => {
    const db = createGroupRouteMockDb()
    const groups = readMockGroups(db)
    groups.set('custom-parent', { ...groupRow('custom-parent', 'Parent'), group_ids: '["custom-child"]' })
    groups.set('custom-child', groupRow('custom-child', 'Child'))

    const response = await groupsApp.request('/custom-child', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupIds: ['custom-parent'] }),
    }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'group reference cycle detected: custom-parent -> custom-child -> custom-parent',
    })
    expect(groups.get('custom-child')?.group_ids).toBe('[]')
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('rejects direct edits to built-in groups', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/builtin-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Built-in groups are managed by routing templates',
    })
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('only reorders custom groups', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['custom-downloads', 'builtin-ai'] }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(readMockGroupOrder(db, 'custom-downloads')).toBe(0)
    expect(readMockGroupOrder(db, 'builtin-ai')).toBe(1)
  })

  it('rejects incomplete or stale reorder requests without changing any order', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['custom-downloads', 'missing-group'] }),
    }, { DB: db })

    expect(response.status).toBe(409)
    expect(readMockGroupOrder(db, 'custom-downloads')).toBe(10)
    expect((db.batch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('initializes zero-setup defaults after deleting a group', async () => {
    const db = createGroupRouteMockDb()

    const response = await groupsApp.request('/custom-downloads', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('rejects deleting a group that is still nested in another policy group', async () => {
    const db = createGroupRouteMockDb()
    const groups = readMockGroups(db)
    groups.set('custom-parent', {
      ...groupRow('custom-parent', 'Parent'),
      collection_ids: '["collection-test"]',
      group_ids: '["custom-downloads"]',
    })

    const response = await groupsApp.request('/custom-downloads', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'group is referenced by policy group: Parent',
      code: 'resource_in_use',
      details: {
        dependency: { type: 'policy-group', id: 'custom-parent', name: 'Parent' },
        remediation: { target: 'groups', id: 'custom-parent' },
        dependencies: [{
          type: 'policy-group',
          id: 'custom-parent',
          name: 'Parent',
          remediation: { target: 'groups', id: 'custom-parent' },
        }],
      },
    })
    expect(groups.has('custom-downloads')).toBe(true)
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('returns the exact export profile remediation when it scopes the group', async () => {
    const db = createGroupRouteMockDb()
    readMockExportConfigs(db).set('export-mobile', {
      id: 'export-mobile',
      name: 'Mobile',
      include_group_ids: '["custom-downloads"]',
    })
    readMockExportConfigs(db).set('export-tablet', {
      id: 'export-tablet',
      name: 'Tablet',
      include_group_ids: '["custom-downloads"]',
    })

    const response = await groupsApp.request('/custom-downloads', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'group is included by export profile: Mobile',
      code: 'resource_in_use',
      details: {
        dependency: { type: 'export-profile', id: 'export-mobile', name: 'Mobile' },
        remediation: { target: 'export', id: 'export-mobile' },
        dependencies: [
          {
            type: 'export-profile',
            id: 'export-mobile',
            name: 'Mobile',
            remediation: { target: 'export', id: 'export-mobile' },
          },
          {
            type: 'export-profile',
            id: 'export-tablet',
            name: 'Tablet',
            remediation: { target: 'export', id: 'export-tablet' },
          },
        ],
      },
    })
  })
})

function createGroupRouteMockDb(): D1Database {
  const groups = new Map<string, Record<string, unknown>>([
    ['custom-downloads', groupRow('custom-downloads', 'Downloads')],
    ['builtin-ai', groupRow('builtin-ai', 'AI', 1, 1)],
  ])
  const exportConfigs = new Map<string, Record<string, unknown>>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT MAX(sort_order)')) return { max_order: 10 }
          if (sql.includes('SELECT * FROM groups WHERE id = ?')) {
            return groups.get(String(args[0])) ?? null
          }
          if (sql.includes('SELECT id, is_builtin FROM groups WHERE id = ?')) {
            const row = groups.get(String(args[0]))
            return row ? { id: row.id, is_builtin: row.is_builtin } : null
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO groups')) {
            groups.set(String(args[0]), groupRow(String(args[0]), String(args[1]), Number(args[11] ?? 11)))
          }
          if (sql.includes('UPDATE groups SET sort_order')) {
            const row = groups.get(String(args[2]))
            if (row && !row.is_builtin) row.sort_order = args[0]
            return { success: true }
          }
          if (sql.includes('UPDATE groups SET')) {
            const id = String(args[11])
            const existing = groups.get(id) ?? groupRow(id, 'Downloads')
            groups.set(id, {
              ...existing,
              group_ids: args[3],
              enabled: args[9],
              updated_at: args[10],
            })
          }
          if (sql.includes('DELETE FROM groups WHERE id = ?')) {
            groups.delete(String(args[0]))
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => {
        if (sql.includes('SELECT MAX(sort_order)')) return { max_order: 10 }
        return null
      },
      all: async () => {
        if (sql.includes('SELECT id FROM collections')) {
          return { results: [] }
        }
        if (sql.includes('SELECT id, name, type, collection_ids, group_ids, enabled, is_builtin FROM groups')) {
          return {
            results: [...groups.values()].map(row => ({
              id: row.id,
              name: row.name,
              type: row.type,
              collection_ids: row.collection_ids,
              group_ids: row.group_ids,
              enabled: row.enabled,
              is_builtin: row.is_builtin,
            })),
          }
        }
        if (sql.includes('SELECT id, group_ids FROM groups')) {
          return {
            results: [...groups.values()].map(row => ({
              id: row.id,
              group_ids: row.group_ids,
            })),
          }
        }
        if (sql.includes('SELECT id, name, include_group_ids FROM export_configs')) {
          return { results: [...exportConfigs.values()] }
        }
        if (sql.includes('SELECT id FROM groups')) {
          return { results: [...groups.keys()].map(id => ({ id })) }
        }
        if (sql.includes('SELECT * FROM groups')) {
          return { results: [...groups.values()].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)) }
        }
        return { results: [] }
      },
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => {
      for (const statement of statements) await statement.run()
      return []
    }),
    __groups: groups,
    __exportConfigs: exportConfigs,
  }

  return mockDb as unknown as D1Database
}

function readMockGroupOrder(db: D1Database, id: string): unknown {
  const groups = readMockGroups(db)
  return groups.get(id)?.sort_order
}

function readMockGroups(db: D1Database): Map<string, Record<string, unknown>> {
  return (db as unknown as { __groups: Map<string, Record<string, unknown>> }).__groups
}

function readMockExportConfigs(db: D1Database): Map<string, Record<string, unknown>> {
  return (db as unknown as { __exportConfigs: Map<string, Record<string, unknown>> }).__exportConfigs
}

function groupRow(id: string, name: string, sortOrder = 10, isBuiltin = 0): Record<string, unknown> {
  return {
    id,
    name,
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    builtins: '[]',
    test_url: null,
    interval: null,
    tolerance: null,
    lazy: null,
    enabled: 1,
    sort_order: sortOrder,
    is_builtin: isBuiltin,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}
