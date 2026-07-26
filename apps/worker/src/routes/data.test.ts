import { beforeEach, describe, expect, it, vi } from 'vitest'
import dataApp, {
  restoreDefaultData,
  validateBackupPayload as validateCurrentBackupPayload,
} from './data'
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
    await expect(response.json()).resolves.toMatchObject({ data: { version: 5 } })
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
      body: JSON.stringify(currentBackup()),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('rejects unknown tables and SQL identifier-like columns before touching the database', async () => {
    expect(validateBackupPayload({ version: 5, tables: { unexpected: [] } })).toEqual({
      valid: false,
      error: 'unknown backup table: unexpected',
    })
    expect(validateBackupPayload({ version: 5, tables: { sources: [{ "id) VALUES ('x'); --": 'bad' }] } })).toEqual({
      valid: false,
      error: "unknown column sources.id) VALUES ('x'); --",
    })
  })

  it('rejects dangling references before destructive restore', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBackup({ nodes: [nodeRow('n1', 'missing')] })),
    }, { DB: db })

    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('rejects missing, null, and invalid constrained fields before destructive restore', async () => {
    expect(validateBackupPayload({ version: 5, tables: { sources: [{ id: 'source-1' }] } })).toEqual({
      valid: false,
      error: 'sources[0].name is required',
    })
    expect(validateBackupPayload({ version: 5, tables: { sources: [{ ...sourceRow('source-1'), format: null }] } })).toEqual({
      valid: false,
      error: 'sources[0].format must not be null',
    })
    expect(validateBackupPayload({ version: 5, tables: { sources: [{ ...sourceRow('source-1'), type: 'unknown' }] } })).toEqual({
      valid: false,
      error: 'sources[0].type is invalid',
    })
    expect(validateBackupPayload({
      version: 5,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), status: 'failed' }] },
    })).toEqual({ valid: false, error: 'source_import_runs[0].status is invalid' })

    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBackup({ sources: [{ id: 'source-1' }] })),
    }, { DB: db })
    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('validates optional export-profile conversion policies', () => {
    expect(validateBackupPayload({
      version: 5,
      tables: {
        export_configs: [{
          ...exportRow('export-1', 'token-1'),
          rule_set_conversion_policy: 'strict',
        }],
      },
    })).toMatchObject({ valid: true, version: 5 })
    expect(validateBackupPayload({
      version: 5,
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
      data: { version: 5, tables: { sources: [sourceRow('source-1')] } },
    })).toMatchObject({ valid: true, version: 5, totalRows: 1 })
  })

  it('rejects duplicate primary identifiers and export tokens before restore', () => {
    expect(validateBackupPayload({
      version: 5,
      tables: { sources: [sourceRow('source-1'), sourceRow('source-1')] },
    })).toEqual({ valid: false, error: 'sources[1].id duplicates source-1' })
    expect(validateBackupPayload({
      version: 5,
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
      version: 5,
      tables: { collections: [{ ...collectionRow('collection-1'), source_ids: '{', node_ids: '[]' }] },
    })).toEqual({ valid: false, error: 'collections[0].source_ids must contain valid JSON' })
    expect(validateBackupPayload({
      version: 5,
      tables: { groups: [{ ...groupRow('group-1'), collection_ids: '["missing"]', group_ids: '[]' }] },
    })).toEqual({ valid: false, error: 'groups[0].collection_ids references a missing collection: missing' })
    expect(validateBackupPayload({
      version: 5,
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
      version: 5,
      tables: {
        groups: [{ ...groupRow('group-1'), group_ids: '["group-1"]' }],
      },
    })).toEqual({
      valid: false,
      error: 'group reference cycle detected: group-1 -> group-1',
    })
    expect(validateBackupPayload({
      version: 5,
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
      body: JSON.stringify(currentBackup({
          groups: [
            { ...groupRow('group-a'), group_ids: '["group-b"]' },
            { ...groupRow('group-b'), group_ids: '["group-a"]' },
          ],
      })),
    }, { DB: db })
    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('validates target-native rule-set sources in backups', () => {
    expect(validateBackupPayload({
      version: 5,
      tables: { remote_rule_sets: [{ ...remoteRuleSetRow('remote-1'), source_overrides: '{' }] },
    })).toEqual({ valid: false, error: 'remote_rule_sets[0].source_overrides must contain valid JSON' })
    expect(validateBackupPayload({
      version: 5,
      tables: { remote_rule_sets: [{
        ...remoteRuleSetRow('remote-1'),
        source_overrides: JSON.stringify({ nodes_raw: 'https://example.com/raw.list' }),
      }] },
    })).toEqual({
      valid: false,
      error: 'remote_rule_sets[0].source_overrides must contain only supported targets and public http(s) URLs',
    })
    expect(validateBackupPayload({
      version: 5,
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
      version: 5,
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
        app_settings: [{ ...appSettingsRow(), default_export_token: 'token-1' }],
      },
    })).toMatchObject({ valid: true, version: 5, totalRows: 8 })
  })

  it('validates optional import history source references without requiring an active source after undo', () => {
    expect(validateBackupPayload({
      version: 5,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), source_id: 'missing' }] },
    })).toEqual({ valid: false, error: 'source_import_runs[0] references a missing source' })
    expect(validateBackupPayload({
      version: 5,
      tables: { source_import_runs: [{ ...importRunRow('run-1'), source_id: null }] },
    })).toMatchObject({ valid: true, version: 5, totalRows: 1 })
  })

  it('supports non-destructive backup validation with a row summary', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBackup({ sources: [sourceRow('s1')] })),
    }, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { version: 5, totalRows: 1, containsSensitiveData: true, tables: { sources: 1 } },
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

type BackupTables = Record<string, unknown>

function currentTables(overrides: BackupTables = {}): BackupTables {
  return {
    sources: [],
    nodes: [],
    collections: [],
    groups: [],
    rules: [],
    remote_rule_sets: [],
    export_configs: [],
    app_settings: [],
    source_import_runs: [],
    ...overrides,
  }
}

function currentBackup(tables: BackupTables = {}): Record<string, unknown> {
  return { version: 5, tables: currentTables(tables) }
}

function validateBackupPayload(value: unknown) {
  if (!isTestRecord(value)) return validateCurrentBackupPayload(value)
  if (isTestRecord(value.data) && isTestRecord(value.data.tables)) {
    return validateCurrentBackupPayload({
      ...value,
      data: { ...value.data, tables: currentTables(value.data.tables) },
    })
  }
  if (isTestRecord(value.tables)) {
    return validateCurrentBackupPayload({ ...value, tables: currentTables(value.tables) })
  }
  return validateCurrentBackupPayload(value)
}

function isTestRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sourceRow(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Source',
    type: 'url',
    url: 'https://example.com/subscription',
    format: 'auto',
    enabled: 1,
    node_count: 0,
    last_updated: null,
    last_refresh_error: null,
    update_interval: 0,
    user_agent: null,
    notes: null,
    tags: '[]',
    source_groups: '[]',
    raw_content: null,
    upload_bytes: null,
    download_bytes: null,
    total_bytes: null,
    expire_time: null,
    created_at: TS,
    updated_at: TS,
  }
}

function nodeRow(id: string, sourceId: string): Record<string, unknown> {
  return {
    id,
    source_id: sourceId,
    name: 'Node',
    protocol: 'ss',
    server: 'example.com',
    port: 443,
    country: null,
    country_code: null,
    enabled: 1,
    tags: '[]',
    notes: null,
    raw_config: '{}',
    parsed_config: '{}',
    is_manual: 0,
    created_at: TS,
    updated_at: TS,
  }
}

function collectionRow(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Collection',
    source_ids: '[]',
    node_ids: '[]',
    filters: '[]',
    renames: '[]',
    dedup: 'name',
    sort: 'country',
    sort_country_order: null,
    enabled: 1,
    notes: null,
    created_at: TS,
    updated_at: TS,
  }
}

function groupRow(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Group',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    builtins: '[]',
    test_url: null,
    interval: 300,
    tolerance: 150,
    lazy: 1,
    enabled: 1,
    sort_order: 0,
    is_builtin: 0,
    created_at: TS,
    updated_at: TS,
  }
}

function ruleRow(id: string): Record<string, unknown> {
  return {
    id,
    name: null,
    type: 'DOMAIN',
    payload: 'example.com',
    no_resolve: 0,
    target_group_id: 'group-1',
    enabled: 1,
    sort_order: 0,
    notes: null,
    compatibility: '[]',
    created_at: TS,
    updated_at: TS,
  }
}

function remoteRuleSetRow(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Remote',
    url: 'https://example.com/rules.txt',
    format: 'text',
    behavior: 'classical',
    preset_source: null,
    preset_id: null,
    source_overrides: '{}',
    source_id: null,
    source_rule_set_key: null,
    source_missing: 0,
    target_group_id: 'group-1',
    update_interval: 24,
    enabled: 1,
    sort_order: 0,
    last_updated: null,
    notes: null,
    created_at: TS,
    updated_at: TS,
  }
}

function exportRow(id: string, token: string): Record<string, unknown> {
  return {
    id,
    name: 'Export',
    format: 'mihomo',
    dns_mode: 'smart',
    token,
    enabled: 1,
    include_collection_ids: '[]',
    include_group_ids: '[]',
    include_rule_ids: '[]',
    include_remote_set_ids: '[]',
    rule_set_conversion_policy: null,
    extra_config: null,
    created_at: TS,
    updated_at: TS,
  }
}

function appSettingsRow(): Record<string, unknown> {
  return {
    id: 'singleton',
    language: 'zh',
    theme: 'system',
    unmatched_traffic_policy: 'proxy',
    routing_policy_template: 'common',
    routing_outlet_preferences: null,
    export_node_naming_mode: 'smart',
    default_export_token: null,
    show_compatibility_warnings: 1,
    rule_set_conversion_policy: 'compatible',
    enable_auto_refresh: 1,
    auto_refresh_interval: 1440,
    auto_node_groups_enabled: 1,
    auto_node_group_types: '["url-test"]',
    auto_node_group_keys: null,
    auto_node_group_include_flag: 1,
    updated_at: TS,
  }
}

function importRunRow(id: string): Record<string, unknown> {
  return {
    id,
    source_id: null,
    source_name: 'Imported',
    format: 'clash',
    node_import_mode: 'all',
    status: 'success',
    node_count: 0,
    added_count: 0,
    updated_count: 0,
    skipped_existing_count: 0,
    rule_count: 0,
    remote_rule_set_count: 0,
    skipped_rule_count: 0,
    conflict_count: 0,
    refresh_error: null,
    structured_error: null,
    structured_changes: '[]',
    created_at: TS,
    completed_at: TS,
    undone_at: null,
  }
}
