import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportConfig } from '@uni-conf/types';
import { buildExportData } from './export-data';
import { getAppSettings } from './services/app-settings';

vi.mock('./services/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    exportNodeNamingMode: 'source_region_sequence',
  })),
}));

describe('buildExportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects export rows without mutating zero-setup state', async () => {
    const db = createEmptyDb();

    await buildExportData(db);

    expect(getAppSettings).toHaveBeenCalledOnce();
  });

  it('exports nodes required by global outlets referenced by a selected routing policy group', async () => {
    const db = createScopedDb();
    const data = await buildExportData(db, {
      id: 'export-ai',
      name: 'AI export',
      format: 'mihomo',
      token: 'token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: ['builtin-ai'],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies ExportConfig);

    expect(data.groups.map((group) => group.id)).toEqual([
      'builtin-proxy',
      'builtin-ai',
      'builtin-direct',
      'builtin-reject',
      'builtin-auto-select',
      'us-auto',
    ]);
    expect(data.nodes.map((node) => node.server).sort()).toEqual(['hk.example.com', 'us.example.com']);
    expect(data.nodes.map((node) => node.server)).not.toContain('us-high.example.com');
    expect(data.nodes.map((node) => node.server)).not.toContain('us-disabled.example.com');
    expect(data.collectionNodeNames['collection-us']).toEqual(['Airport A - US - 01']);
    expect(data.collectionNodeNames['collection-hk']).toEqual(['Airport A - HK - 01']);
  });

  it('keeps DIRECT and REJECT rules when a selected routing policy group references foundation targets', async () => {
    const db = createScopedDb();
    const data = await buildExportData(db, {
      id: 'export-ai',
      name: 'AI export',
      format: 'mihomo',
      token: 'token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: ['builtin-ai'],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies ExportConfig);

    expect(data.rules.map((rule) => [rule.type, rule.payload, rule.targetGroupId])).toEqual([
      ['DOMAIN-SUFFIX', 'lan.example', 'builtin-direct'],
      ['DOMAIN-SUFFIX', 'ads.example', 'builtin-reject'],
    ]);
  });
});

function createEmptyDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true }),
        raw: async () => [],
      })),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}

function createScopedDb(): D1Database {
  const rows = {
    nodes: [
      nodeRow('node-us', 'US 01', 'us.example.com', 'US'),
      nodeRow('node-hk', 'HK 01', 'hk.example.com', 'HK'),
      nodeRow('node-us-high', 'US 10x', 'us-high.example.com', 'US', ['high-multiplier']),
      nodeRow('node-disabled-source', 'US Disabled 01', 'us-disabled.example.com', 'US', [], 'source-disabled'),
    ],
    collections: [
      collectionRow('builtin-default-node-pool', '默认可用节点'),
      collectionRow('collection-us', 'US Auto', 'US'),
      collectionRow('collection-hk', 'HK Auto', 'HK'),
    ],
    groups: [
      groupRow('builtin-proxy', 'PROXY', 'select', [], [], 0, true),
      groupRow('builtin-ai', 'AI', 'select', [], [], 1, true),
      groupRow('builtin-direct', 'DIRECT', 'direct', [], [], 2, true, ['DIRECT']),
      groupRow('builtin-reject', 'REJECT', 'reject', [], [], 3, true, ['REJECT']),
      groupRow('builtin-auto-select', '自动选择', 'url-test', ['builtin-default-node-pool'], [], 4, true),
      groupRow('us-auto', 'US Auto', 'url-test', ['collection-us'], [], 5, false),
    ],
    rules: [
      ruleRow('rule-direct', 'DOMAIN-SUFFIX', 'lan.example', 'builtin-direct', 10),
      ruleRow('rule-reject', 'DOMAIN-SUFFIX', 'ads.example', 'builtin-reject', 20),
      ruleRow('rule-disabled-target', 'DOMAIN-SUFFIX', 'disabled.example', 'disabled-group', 30),
    ],
    sources: [
      {
        id: 'source-a',
        name: 'Airport A',
        type: 'url',
        url: 'https://example.com/sub',
        format: 'auto',
        enabled: 1,
        node_count: 2,
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
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'source-disabled',
        name: 'Disabled Airport',
        type: 'url',
        url: 'https://disabled.example.com/sub',
        format: 'auto',
        enabled: 0,
        node_count: 1,
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
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => statementForSql(sql, rows)),
      ...statementForSql(sql, rows),
    })),
  } as unknown as D1Database;
}

interface ScopedRows {
  nodes: Record<string, unknown>[];
  collections: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  sources: Record<string, unknown>[];
}

function statementForSql(sql: string, rows: ScopedRows) {
  return {
    all: async () => ({ results: rowsForSql(sql, rows) }),
    first: async () => null,
    run: async () => ({ success: true }),
    raw: async () => [],
  };
}

function rowsForSql(sql: string, rows: ScopedRows): Record<string, unknown>[] {
  if (sql.includes('FROM nodes n')) {
    if (!sql.includes('INNER JOIN sources s') || !sql.includes('s.enabled = 1')) return rows.nodes;
    const enabledSourceIds = new Set(rows.sources.filter((source) => source['enabled'] === 1).map((source) => source['id']));
    return rows.nodes.filter((node) => enabledSourceIds.has(node['source_id']));
  }
  if (sql.includes('SELECT id, notes FROM collections')) return [];
  if (sql.includes('SELECT * FROM collections')) return rows.collections;
  if (sql.includes('SELECT * FROM groups')) return rows.groups;
  if (sql.includes('SELECT id, name FROM sources')) return rows.sources.map(({ id, name }) => ({ id, name }));
  if (sql.includes('SELECT * FROM sources')) return rows.sources;
  if (sql.includes('SELECT * FROM rules')) return rows.rules;
  if (sql.includes('SELECT * FROM remote_rule_sets')) return [];
  return [];
}

function nodeRow(
  id: string,
  name: string,
  server: string,
  countryCode: string,
  tags: string[] = [],
  sourceId = 'source-a'
): Record<string, unknown> {
  return {
    id,
    source_id: sourceId,
    name,
    protocol: 'ss',
    server,
    port: 443,
    country: countryCode === 'US' ? 'United States' : 'Hong Kong',
    country_code: countryCode,
    enabled: 1,
    tags: JSON.stringify(tags),
    notes: null,
    raw_config: '{}',
    parsed_config: JSON.stringify({ protocol: 'ss', server, port: 443, extra: {} }),
    is_manual: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function collectionRow(id: string, name: string, countryCode?: string): Record<string, unknown> {
  return {
    id,
    name,
    source_ids: '[]',
    node_ids: '[]',
    filters: JSON.stringify(countryCode
      ? [
          { id: `${id}-country`, field: 'countryCode', operator: 'equals', value: countryCode, enabled: true },
          { id: `${id}-exclude-high-multiplier`, field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ]
      : [{ id: 'default-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true }]),
    renames: '[]',
    dedup: 'name',
    sort: 'country',
    sort_country_order: null,
    enabled: 1,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function groupRow(
  id: string,
  name: string,
  type: string,
  collectionIds: string[],
  groupIds: string[],
  sortOrder: number,
  isBuiltin: boolean,
  builtins: string[] = []
): Record<string, unknown> {
  return {
    id,
    name,
    type,
    collection_ids: JSON.stringify(collectionIds),
    group_ids: JSON.stringify(groupIds),
    builtins: JSON.stringify(builtins),
    test_url: null,
    interval: null,
    tolerance: null,
    lazy: null,
    enabled: 1,
    sort_order: sortOrder,
    is_builtin: isBuiltin ? 1 : 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function ruleRow(
  id: string,
  type: string,
  payload: string,
  targetGroupId: string,
  sortOrder: number
): Record<string, unknown> {
  return {
    id,
    name: null,
    type,
    payload,
    no_resolve: 0,
    target_group_id: targetGroupId,
    enabled: 1,
    sort_order: sortOrder,
    notes: null,
    compatibility: '[]',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
