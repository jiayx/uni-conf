import { beforeEach, describe, expect, it, vi } from 'vitest'
import dataApp, { restoreDefaultData, validateBackupPayload } from './data'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('data reset defaults', () => {
  beforeEach(() => {
    vi.mocked(ensureZeroSetupDefaults).mockReset()
  })

  it('restores zero-setup defaults after clearing data', async () => {
    const db = {} as D1Database
    const ts = '2026-01-01T00:00:00.000Z'

    await restoreDefaultData(db, ts)

    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, ts)
  })

  it('restores defaults before exporting data', async () => {
    const db = createMockDb()

    const response = await dataApp.request('/export', {}, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { version: 4 } })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="uni-conf-backup-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('restores defaults after importing data', async () => {
    const db = createMockDb()

    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 4, tables: {} }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('rejects unknown tables and SQL identifier-like columns before touching the database', async () => {
    expect(validateBackupPayload({ version: 4, tables: { unexpected: [] } })).toEqual({
      valid: false,
      error: 'unknown backup table: unexpected',
    })
    expect(validateBackupPayload({ version: 4, tables: { sources: [{ "id) VALUES ('x'); --": 'bad' }] } })).toEqual({
      valid: false,
      error: "unknown column sources.id) VALUES ('x'); --",
    })
  })

  it('rejects dangling references before destructive restore', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 4, tables: { nodes: [nodeRow('n1', 'missing')] } }),
    }, { DB: db })

    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('rejects missing, null, and invalid constrained fields before destructive restore', async () => {
    expect(validateBackupPayload({ version: 4, tables: { sources: [{ id: 'source-1' }] } })).toEqual({
      valid: false,
      error: 'sources[0].name is required',
    })
    expect(validateBackupPayload({ version: 4, tables: { sources: [{ ...sourceRow('source-1'), format: null }] } })).toEqual({
      valid: false,
      error: 'sources[0].format must not be null',
    })
    expect(validateBackupPayload({ version: 4, tables: { sources: [{ ...sourceRow('source-1'), type: 'unknown' }] } })).toEqual({
      valid: false,
      error: 'sources[0].type is invalid',
    })
    expect(validateBackupPayload({
      version: 4,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), status: 'failed' }] },
    })).toEqual({ valid: false, error: 'source_import_runs[0].status is invalid' })

    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 4, tables: { sources: [{ id: 'source-1' }] } }),
    }, { DB: db })
    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('validates optional export-profile conversion policies', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: {
        export_configs: [{
          ...exportRow('export-1', 'token-1'),
          rule_set_conversion_policy: 'strict',
        }],
      },
    })).toMatchObject({ valid: true, version: 4 })
    expect(validateBackupPayload({
      version: 4,
      tables: {
        export_configs: [{
          ...exportRow('export-1', 'token-1'),
          rule_set_conversion_policy: 'best-effort',
        }],
      },
    })).toEqual({
      valid: false,
      error: 'export_configs[0].rule_set_conversion_policy is invalid',
    })
  })

  it('accepts the current exported API envelope', () => {
    expect(validateBackupPayload({
      success: true,
      data: { version: 4, tables: { sources: [sourceRow('source-1')] } },
    })).toMatchObject({ valid: true, version: 4, totalRows: 1 })
  })

  it('rejects duplicate primary identifiers and export tokens before restore', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: { sources: [sourceRow('source-1'), sourceRow('source-1')] },
    })).toEqual({ valid: false, error: 'sources[1].id duplicates source-1' })
    expect(validateBackupPayload({
      version: 4,
      tables: {
        export_configs: [
          exportRow('export-1', 'shared'),
          exportRow('export-2', 'shared'),
        ],
      },
    })).toEqual({ valid: false, error: 'export_configs[1].token duplicates shared' })
  })

  it('rejects malformed and dangling JSON relationship lists', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: { collections: [{ ...collectionRow('collection-1'), source_ids: '{', node_ids: '[]' }] },
    })).toEqual({ valid: false, error: 'collections[0].source_ids must contain valid JSON' })
    expect(validateBackupPayload({
      version: 4,
      tables: { groups: [{ ...groupRow('group-1'), collection_ids: '["missing"]', group_ids: '[]' }] },
    })).toEqual({ valid: false, error: 'groups[0].collection_ids references a missing collection: missing' })
    expect(validateBackupPayload({
      version: 4,
      tables: {
        groups: [{ ...groupRow('group-1'), collection_ids: '[]', group_ids: '[]' }],
        export_configs: [{
          ...exportRow('export-1', 'token-1'), include_collection_ids: '[]',
          include_group_ids: '["missing"]', include_rule_ids: '[]', include_remote_set_ids: '[]',
        }],
      },
    })).toEqual({ valid: false, error: 'export_configs[0].include_group_ids references a missing group: missing' })
  })

  it('rejects direct and indirect policy-group reference cycles before destructive restore', async () => {
    expect(validateBackupPayload({
      version: 4,
      tables: {
        groups: [{ ...groupRow('group-1'), group_ids: '["group-1"]' }],
      },
    })).toEqual({
      valid: false,
      error: 'group reference cycle detected: group-1 -> group-1',
    })
    expect(validateBackupPayload({
      version: 4,
      tables: {
        groups: [
          { ...groupRow('group-a'), group_ids: '["group-b"]' },
          { ...groupRow('group-b'), group_ids: '["group-c"]' },
          { ...groupRow('group-c'), group_ids: '["group-a"]' },
        ],
      },
    })).toEqual({
      valid: false,
      error: 'group reference cycle detected: group-a -> group-b -> group-c -> group-a',
    })

    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 4,
        tables: {
          groups: [
            { ...groupRow('group-a'), group_ids: '["group-b"]' },
            { ...groupRow('group-b'), group_ids: '["group-a"]' },
          ],
        },
      }),
    }, { DB: db })
    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('validates target-native rule-set sources in backups', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: { remote_rule_sets: [{ ...remoteRuleSetRow('remote-1'), source_overrides: '{' }] },
    })).toEqual({ valid: false, error: 'remote_rule_sets[0].source_overrides must contain valid JSON' })
    expect(validateBackupPayload({
      version: 4,
      tables: { remote_rule_sets: [{
        ...remoteRuleSetRow('remote-1'),
        source_overrides: JSON.stringify({ nodes_raw: 'https://example.com/raw.list' }),
      }] },
    })).toEqual({
      valid: false,
      error: 'remote_rule_sets[0].source_overrides must contain only supported targets and public http(s) URLs',
    })
    expect(validateBackupPayload({
      version: 4,
      tables: {
        groups: [groupRow('group-1')],
        remote_rule_sets: [{
          ...remoteRuleSetRow('remote-1'),
          source_overrides: JSON.stringify({ singbox: 'https://example.com/rules.srs', egern: 'https://example.com/rules.yaml' }),
        }],
      },
    })).toMatchObject({ valid: true, totalRows: 2 })
  })

  it('accepts a connected backup graph with scoped export references', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: {
        sources: [sourceRow('source-1')],
        nodes: [nodeRow('node-1', 'source-1')],
        collections: [{ ...collectionRow('collection-1'), source_ids: '["source-1"]', node_ids: '["node-1"]' }],
        groups: [{ ...groupRow('group-1'), collection_ids: '["collection-1"]', group_ids: '[]' }],
        rules: [{ ...ruleRow('rule-1'), target_group_id: 'group-1' }],
        remote_rule_sets: [{ ...remoteRuleSetRow('remote-1'), target_group_id: 'group-1' }],
        export_configs: [{
          ...exportRow('export-1', 'token-1'), include_collection_ids: '["collection-1"]',
          include_group_ids: '["group-1"]', include_rule_ids: '["rule-1"]', include_remote_set_ids: '["remote-1"]',
        }],
        app_settings: [{ id: 'singleton', default_export_token: 'token-1', updated_at: TS }],
      },
    })).toMatchObject({ valid: true, version: 4, totalRows: 8 })
  })

  it('validates optional import history source references without requiring an active source after undo', () => {
    expect(validateBackupPayload({
      version: 4,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), source_id: 'missing' }] },
    })).toEqual({ valid: false, error: 'source_import_runs[0] references a missing source' })
    expect(validateBackupPayload({
      version: 4,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), source_id: null }] },
    })).toMatchObject({ valid: true, version: 4, totalRows: 1 })
  })

  it('supports non-destructive backup validation with a row summary', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 4, tables: { sources: [sourceRow('s1')] } }),
    }, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { version: 4, totalRows: 1, containsSensitiveData: true, tables: { sources: 1 } },
    })
    expect(db.batch).not.toHaveBeenCalled()
  })
})

function createMockDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({ results: [] }),
        raw: async () => [],
      })),
      run: async () => ({ success: true }),
      first: async () => null,
      all: async () => ({ results: [] }),
      raw: async () => [],
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database
}

const TS = '2026-01-01T00:00:00.000Z'

function sourceRow(id: string): Record<string, unknown> {
  return { id, name: 'Source', type: 'url', created_at: TS, updated_at: TS }
}

function nodeRow(id: string, sourceId: string): Record<string, unknown> {
  return { id, source_id: sourceId, name: 'Node', protocol: 'ss', server: 'example.com', port: 443, created_at: TS, updated_at: TS }
}

function collectionRow(id: string): Record<string, unknown> {
  return { id, name: 'Collection', created_at: TS, updated_at: TS }
}

function groupRow(id: string): Record<string, unknown> {
  return { id, name: 'Group', type: 'select', created_at: TS, updated_at: TS }
}

function ruleRow(id: string): Record<string, unknown> {
  return { id, type: 'DOMAIN', payload: 'example.com', target_group_id: 'group-1', created_at: TS, updated_at: TS }
}

function remoteRuleSetRow(id: string): Record<string, unknown> {
  return { id, name: 'Remote', url: 'https://example.com/rules.txt', format: 'text', target_group_id: 'group-1', created_at: TS, updated_at: TS }
}

function exportRow(id: string, token: string): Record<string, unknown> {
  return { id, name: 'Export', format: 'mihomo', token, created_at: TS, updated_at: TS }
}

function importRunRow(id: string): Record<string, unknown> {
  return { id, source_name: 'Imported', format: 'clash', status: 'success', created_at: TS }
}
