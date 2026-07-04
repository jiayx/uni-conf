import { describe, expect, it } from 'vitest';
import { ensureZeroSetupDefaults } from './zero-setup';

describe('zero setup defaults integration', () => {
  it('materializes the default export graph from recognized subscription nodes', async () => {
    const db = createZeroSetupDb();

    const config = await ensureZeroSetupDefaults(db, '2026-01-01T00:00:00.000Z');

    expect(config).toMatchObject({
      id: 'default-mihomo',
      name: '默认 Mihomo 配置',
      format: 'mihomo',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
    });
    expect(db.state.appSettings.default_export_token).toBe(config.token);
    expect(db.state.collections.map((row) => row.name).sort()).toEqual([
      'Native Auto',
      'Streaming Auto',
      '默认可用节点',
      '🇭🇰 HK Auto',
      '🇺🇸 US Auto',
    ]);
    const defaultNodePool = db.state.collections.find((row) => row.id === 'builtin-default-node-pool');
    expect(defaultNodePool?.notes).toBe('[uni-conf:default-node-pool]');
    expect(parseFilters(defaultNodePool?.filters)).toContainEqual(expect.objectContaining({
      field: 'tag',
      operator: 'not_in',
      value: ['high-multiplier'],
    }));

    const groupsByName = new Map(db.state.groups.map((row) => [row.name, row]));
    expect(groupsByName.get('全部节点')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('节点选择')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('自动选择')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('故障切换')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('PROXY')?.group_ids).toContain(groupsByName.get('🇺🇸 US Auto')?.id);
    expect(groupsByName.get('AI')?.group_ids).toEqual(expect.arrayContaining([
      'builtin-proxy',
      'builtin-direct',
      'builtin-reject',
      'builtin-auto-select',
      groupsByName.get('🇺🇸 US Auto')?.id,
      groupsByName.get('Native Auto')?.id,
    ]));
    expect(groupsByName.get('Streaming')?.group_ids).toEqual(expect.arrayContaining([
      'builtin-proxy',
      'builtin-direct',
      'builtin-reject',
      groupsByName.get('Streaming Auto')?.id,
      groupsByName.get('🇭🇰 HK Auto')?.id,
    ]));

    const groupsById = new Map(db.state.groups.map((row) => [row.id, row]));
    const remoteRuleTargets = db.state.remoteRuleSets
      .filter((row) => row.enabled === 1)
      .map((row) => groupsById.get(row.target_group_id)?.name ?? row.target_group_id);
    expect(remoteRuleTargets).toContain('REJECT');
    expect(remoteRuleTargets).toContain('Telegram');
    expect(remoteRuleTargets).toContain('PROXY');
  });

  it('keeps the empty routing template limited to foundation targets and node outlets', async () => {
    const db = createZeroSetupDb({ routingPolicyTemplate: 'empty' });

    await ensureZeroSetupDefaults(db, '2026-01-01T00:00:00.000Z');

    const groupsByName = new Map(db.state.groups.map((row) => [row.name, row]));
    expect(groupsByName.get('PROXY')?.enabled).toBe(1);
    expect(groupsByName.get('DIRECT')?.enabled).toBe(1);
    expect(groupsByName.get('REJECT')?.enabled).toBe(1);
    expect(groupsByName.get('全部节点')?.enabled).toBe(1);
    expect(groupsByName.get('全部节点')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('节点选择')?.enabled).toBe(1);
    expect(groupsByName.get('节点选择')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('自动选择')?.enabled).toBe(1);
    expect(groupsByName.get('自动选择')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('故障切换')?.enabled).toBe(1);
    expect(groupsByName.get('故障切换')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('AI')?.enabled).toBe(0);
    expect(groupsByName.get('Streaming')?.enabled).toBe(0);
    expect(groupsByName.get('Telegram')?.enabled).toBe(0);

    const groupsById = new Map(db.state.groups.map((row) => [row.id, row]));
    const remoteRuleTargets = new Set(db.state.remoteRuleSets
      .filter((row) => row.enabled === 1)
      .map((row) => groupsById.get(row.target_group_id)?.name ?? row.target_group_id));
    expect(remoteRuleTargets).toContain('PROXY');
    expect(remoteRuleTargets).toContain('DIRECT');
    expect(remoteRuleTargets).toContain('REJECT');
    expect(remoteRuleTargets).not.toContain('AI');
    expect(remoteRuleTargets).not.toContain('Streaming');
    expect(remoteRuleTargets).not.toContain('Telegram');
    expect(db.state.remoteRuleSets.some((row) => row.enabled === 0 && groupsById.get(row.target_group_id)?.name === 'AI')).toBe(true);
  });

  it('keeps foundation routing and default rules when auto node groups are disabled', async () => {
    const db = createZeroSetupDb({ autoNodeGroupsEnabled: false });

    await ensureZeroSetupDefaults(db, '2026-01-01T00:00:00.000Z');

    expect(db.state.collections.map((row) => row.name)).toEqual(['默认可用节点']);
    const defaultNodePool = db.state.collections[0];
    expect(defaultNodePool?.id).toBe('builtin-default-node-pool');
    expect(parseFilters(defaultNodePool?.filters)).toContainEqual(expect.objectContaining({
      field: 'tag',
      operator: 'not_in',
      value: ['high-multiplier'],
    }));

    const groupsByName = new Map(db.state.groups.map((row) => [row.name, row]));
    expect(groupsByName.get('PROXY')?.enabled).toBe(1);
    expect(groupsByName.get('DIRECT')?.enabled).toBe(1);
    expect(groupsByName.get('REJECT')?.enabled).toBe(1);
    expect(groupsByName.get('全部节点')?.enabled).toBe(1);
    expect(groupsByName.get('节点选择')?.enabled).toBe(1);
    expect(groupsByName.get('自动选择')?.enabled).toBe(1);
    expect(groupsByName.get('故障切换')?.enabled).toBe(1);
    expect(groupsByName.get('自动选择')?.collection_ids).toEqual(['builtin-default-node-pool']);
    expect(groupsByName.get('PROXY')?.group_ids).toEqual(expect.arrayContaining([
      'builtin-auto-select',
      'builtin-node-select',
      'builtin-fallback-select',
      'builtin-all-nodes',
      'builtin-direct',
      'builtin-reject',
    ]));

    const groupsById = new Map(db.state.groups.map((row) => [row.id, row]));
    const remoteRuleTargets = new Set(db.state.remoteRuleSets
      .filter((row) => row.enabled === 1)
      .map((row) => groupsById.get(row.target_group_id)?.name ?? row.target_group_id));
    expect(remoteRuleTargets).toContain('PROXY');
    expect(remoteRuleTargets).toContain('DIRECT');
    expect(remoteRuleTargets).toContain('REJECT');
  });
});

interface MemoryRow {
  [key: string]: unknown;
}

function createZeroSetupDb(patch: {
  routingPolicyTemplate?: string;
  autoNodeGroupsEnabled?: boolean;
} = {}): D1Database & { state: ZeroSetupState } {
  const state: ZeroSetupState = {
    appSettings: {
      id: 'singleton',
      language: 'zh',
      theme: 'system',
      routing_policy_template: patch.routingPolicyTemplate ?? 'common',
      routing_outlet_preferences: null,
      dns_mode: 'smart',
      export_node_naming_mode: 'smart',
      default_export_token: null,
      show_compatibility_warnings: 1,
      enable_auto_refresh: 1,
      auto_refresh_interval: 1440,
      auto_node_groups_enabled: patch.autoNodeGroupsEnabled === false ? 0 : 1,
      auto_node_group_types: null,
      auto_node_group_keys: null,
      auto_node_group_include_flag: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    nodes: [
      nodeRow('node-us', '🇺🇸 US 01', 'United States', 'US', ['native-ip']),
      nodeRow('node-hk', '🇭🇰 HK 01', 'Hong Kong', 'HK', ['streaming']),
      nodeRow('node-high', '🇺🇸 US 10x', 'United States', 'US', ['high-multiplier']),
    ],
    collections: [],
    groups: [],
    exportConfigs: [],
    remoteRuleSets: [],
  };
  const db: D1Database & { state: ZeroSetupState } = {
    state,
    prepare: (sql: string) => createStatement(state, sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as D1Database & { state: ZeroSetupState };
  return db;
}

interface ZeroSetupState {
  appSettings: MemoryRow;
  nodes: MemoryRow[];
  collections: MemoryRow[];
  groups: MemoryRow[];
  exportConfigs: MemoryRow[];
  remoteRuleSets: MemoryRow[];
}

function createStatement(state: ZeroSetupState, sql: string, args: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...nextArgs: unknown[]) => createStatement(state, sql, nextArgs),
    all: async () => ({ results: selectRows(state, sql, args) }),
    first: async () => selectRows(state, sql, args)[0] ?? null,
    run: async () => {
      runStatement(state, sql, args);
      return { success: true };
    },
    raw: async () => [],
  } as unknown as D1PreparedStatement;
}

function selectRows(state: ZeroSetupState, sql: string, args: unknown[]): MemoryRow[] {
  if (sql.includes('SELECT default_export_token FROM app_settings')) {
    return [{ default_export_token: state.appSettings.default_export_token }];
  }
  if (sql.includes('SELECT * FROM app_settings')) return [state.appSettings];
  if (sql.includes('SELECT * FROM export_configs WHERE token = ?')) {
    return state.exportConfigs.filter((row) => row.token === args[0] && row.enabled === 1);
  }
  if (sql.includes('SELECT * FROM export_configs WHERE id = ?')) {
    return state.exportConfigs.filter((row) => row.id === args[0]);
  }
  if (sql.includes('SELECT id, notes FROM collections WHERE notes LIKE')) {
    return state.collections
      .filter((row) => String(row.notes ?? '').startsWith('[uni-conf:auto-node-group]'))
      .map(({ id, notes }) => ({ id, notes }));
  }
  if (sql.includes('SELECT country_code, country, tags')) {
    return state.nodes
      .filter((row) => row.enabled === 1 && String(row.country_code ?? '').trim())
      .map(({ country_code, country, tags }) => ({ country_code, country, tags }));
  }
  if (sql.includes('SELECT tags FROM')) {
    return state.nodes
      .filter((row) => row.enabled === 1)
      .map(({ tags }) => ({ tags }));
  }
  if (sql.includes('SELECT MAX(sort_order)')) {
    return [{ max_order: Math.max(-1, ...state.groups.map((row) => Number(row.sort_order ?? -1))) }];
  }
  if (sql.includes('SELECT id FROM groups WHERE is_builtin = 0')) {
    return state.groups.filter((row) => row.is_builtin === 0 && row.collection_ids === args[0]).slice(0, 1);
  }
  if (sql.includes('SELECT id, name, type, collection_ids, enabled, is_builtin FROM groups')) {
    return [...state.groups].sort(compareGroupRows).map(({ id, name, type, collection_ids, enabled, is_builtin }) => ({
      id,
      name,
      type,
      collection_ids,
      enabled,
      is_builtin,
    }));
  }
  if (sql.includes('SELECT id, name, enabled FROM groups')) {
    return state.groups.map(({ id, name, enabled }) => ({ id, name, enabled }));
  }
  if (sql.includes('SELECT id, url, format, behavior, preset_source, preset_id, target_group_id')) {
    return state.remoteRuleSets.filter((row) => ['quixotic', 'uni-conf'].includes(String(row.preset_source)) && row.preset_id);
  }
  return [];
}

function runStatement(state: ZeroSetupState, sql: string, args: unknown[]): void {
  if (sql.includes('INSERT OR IGNORE INTO app_settings')) return;
  if (sql.includes('UPDATE app_settings SET default_export_token')) {
    state.appSettings.default_export_token = args[0];
    state.appSettings.updated_at = args[1];
    return;
  }
  if (sql.includes('INSERT INTO export_configs')) {
    state.exportConfigs.push({
      id: args[0],
      name: '默认 Mihomo 配置',
      format: 'mihomo',
      token: args[1],
      enabled: 1,
      include_collection_ids: '[]',
      include_group_ids: '[]',
      include_rule_ids: '[]',
      include_remote_set_ids: '[]',
      extra_config: null,
      created_at: args[2],
      updated_at: args[3],
    });
    return;
  }
  if (sql.includes('UPDATE export_configs SET enabled = 1')) {
    const row = state.exportConfigs.find((item) => item.id === args[1]);
    if (row) {
      row.enabled = 1;
      row.updated_at = args[0];
    }
    return;
  }
  if (sql.includes('INSERT OR IGNORE INTO collections')) {
    if (!state.collections.some((row) => row.id === args[0])) {
      state.collections.push({
        id: args[0],
        name: '默认可用节点',
        source_ids: '[]',
        node_ids: '[]',
        filters: args[1],
        renames: '[]',
        dedup: 'full_config',
        sort: 'name',
        sort_country_order: '[]',
        enabled: 1,
        notes: args[2],
        created_at: args[3],
        updated_at: args[4],
      });
    }
    return;
  }
  if (sql.includes('UPDATE collections SET') && sql.includes("name = '默认可用节点'")) {
    const row = state.collections.find((item) => item.id === args[3]);
    if (row) {
      Object.assign(row, {
        name: '默认可用节点',
        source_ids: '[]',
        node_ids: '[]',
        filters: args[0],
        renames: '[]',
        dedup: 'full_config',
        sort: 'name',
        sort_country_order: '[]',
        enabled: 1,
        notes: args[1],
        updated_at: args[2],
      });
    }
    return;
  }
  if (sql.includes('INSERT INTO collections')) {
    state.collections.push({
      id: args[0],
      name: args[1],
      source_ids: '[]',
      node_ids: '[]',
      filters: args[2],
      renames: '[]',
      dedup: 'full_config',
      sort: 'name',
      sort_country_order: '[]',
      enabled: 1,
      notes: args[3],
      created_at: args[4],
      updated_at: args[5],
    });
    return;
  }
  if (sql.includes('INSERT OR IGNORE INTO groups')) {
    if (!state.groups.some((row) => row.id === args[0])) {
      state.groups.push(groupRow(args, true));
    }
    return;
  }
  if (sql.includes('INSERT INTO groups')) {
    state.groups.push(groupRow(args, false));
    return;
  }
  if (sql.includes('UPDATE groups SET') && sql.includes('name = ?') && sql.includes('is_builtin = 1')) {
    const row = state.groups.find((item) => item.id === args[10]);
    if (row) {
      Object.assign(row, {
        name: args[0],
        type: args[1],
        collection_ids: parseJsonArray(args[2]),
        builtins: args[3],
        test_url: args[4],
        interval: args[5],
        tolerance: args[6],
        lazy: args[7],
        sort_order: args[8],
        is_builtin: 1,
        updated_at: args[9],
      });
    }
    return;
  }
  if (sql.includes('UPDATE groups SET enabled = ?')) {
    const row = state.groups.find((item) => item.id === args[2]);
    if (row) {
      row.enabled = args[0];
      row.updated_at = args[1];
    }
    return;
  }
  if (sql.includes('UPDATE groups SET group_ids = ?')) {
    const row = state.groups.find((item) => item.id === args[2]);
    if (row) {
      row.group_ids = JSON.parse(String(args[0])) as string[];
      row.updated_at = args[1];
    }
    return;
  }
  if (sql.includes('INSERT INTO remote_rule_sets') && sql.includes("'mihomo', ?, 'quixotic'")) {
    state.remoteRuleSets.push({
      id: args[0],
      name: args[1],
      url: args[2],
      format: 'mihomo',
      behavior: args[3],
      preset_source: 'quixotic',
      preset_id: args[4],
      target_group_id: args[5],
      update_interval: 24,
      enabled: args[6],
      sort_order: args[7],
      last_updated: null,
      notes: args[8],
      created_at: args[9],
      updated_at: args[10],
    });
    return;
  }
  if (sql.includes('INSERT INTO remote_rule_sets')) {
    state.remoteRuleSets.push({
      id: args[0],
      name: args[1],
      url: args[2],
      format: args[3],
      behavior: args[4],
      preset_source: args[5],
      preset_id: args[6],
      target_group_id: args[7],
      update_interval: 24,
      enabled: args[8],
      sort_order: args[9],
      last_updated: null,
      notes: args[10],
      created_at: args[11],
      updated_at: args[12],
    });
  }
}

function nodeRow(id: string, name: string, country: string, countryCode: string, tags: string[]): MemoryRow {
  return {
    id,
    name,
    country,
    country_code: countryCode,
    tags: JSON.stringify(tags),
    enabled: 1,
  };
}

function groupRow(args: unknown[], isBuiltinInsert: boolean): MemoryRow {
  if (isBuiltinInsert) {
    return {
      id: args[0],
      name: args[1],
      type: args[2],
      collection_ids: parseJsonArray(args[3]),
      group_ids: [],
      builtins: args[4],
      test_url: args[5],
      interval: args[6],
      tolerance: args[7],
      lazy: args[8],
      enabled: 1,
      sort_order: args[9],
      is_builtin: 1,
      created_at: args[10],
      updated_at: args[11],
    };
  }

  return {
    id: args[0],
    name: args[1],
    type: args[2],
    collection_ids: args[3],
    group_ids: [],
    builtins: '[]',
    test_url: args[4],
    interval: args[5],
    tolerance: args[6],
    lazy: args[7],
    enabled: 1,
    sort_order: args[8],
    is_builtin: 0,
    created_at: args[9],
    updated_at: args[10],
  };
}

function compareGroupRows(a: MemoryRow, b: MemoryRow): number {
  return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseFilters(value: unknown): unknown[] {
  return parseJsonArray(value);
}
