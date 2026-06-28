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
      '🇭🇰 HK Auto',
      '🇺🇸 US Auto',
    ]);

    const groupsByName = new Map(db.state.groups.map((row) => [row.name, row]));
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
    const remoteRuleTargets = db.state.remoteRuleSets.map((row) => groupsById.get(row.target_group_id)?.name ?? row.target_group_id);
    expect(remoteRuleTargets).toContain('REJECT');
    expect(remoteRuleTargets).toContain('Telegram');
    expect(remoteRuleTargets).toContain('PROXY');
  });
});

interface MemoryRow {
  [key: string]: unknown;
}

function createZeroSetupDb(): D1Database & { state: ZeroSetupState } {
  const state: ZeroSetupState = {
    appSettings: {
      id: 'singleton',
      language: 'zh',
      theme: 'system',
      routing_policy_template: 'common',
      routing_outlet_preferences: null,
      dns_mode: 'smart',
      export_node_naming_mode: 'smart',
      default_export_token: null,
      show_compatibility_warnings: 1,
      enable_auto_refresh: 1,
      auto_refresh_interval: 1440,
      auto_node_groups_enabled: 1,
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
  if (sql.includes('GROUP BY country_code')) return countryRows(state);
  if (sql.includes('COUNT(*) AS node_count')) return [{ node_count: countTaggedNodes(state, args) }];
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
  if (sql.includes('SELECT id, name FROM groups WHERE enabled = 1')) {
    return state.groups.filter((row) => row.enabled === 1).map(({ id, name }) => ({ id, name }));
  }
  if (sql.includes('SELECT id, url, format, behavior, preset_source, preset_id, target_group_id, sort_order FROM remote_rule_sets')) {
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
    const row = state.groups.find((item) => item.id === args[9]);
    if (row) {
      Object.assign(row, {
        name: args[0],
        type: args[1],
        collection_ids: '[]',
        builtins: args[2],
        test_url: args[3],
        interval: args[4],
        tolerance: args[5],
        lazy: args[6],
        sort_order: args[7],
        is_builtin: 1,
        updated_at: args[8],
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
  if (sql.includes('INSERT INTO remote_rule_sets') && sql.includes("'mihomo', 'classical', 'quixotic'")) {
    state.remoteRuleSets.push({
      id: args[0],
      name: args[1],
      url: args[2],
      format: 'mihomo',
      behavior: 'classical',
      preset_source: 'quixotic',
      preset_id: args[3],
      target_group_id: args[4],
      update_interval: 24,
      enabled: 1,
      sort_order: args[5],
      last_updated: null,
      notes: args[6],
      created_at: args[7],
      updated_at: args[8],
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
      enabled: 1,
      sort_order: args[8],
      last_updated: null,
      notes: args[9],
      created_at: args[10],
      updated_at: args[11],
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

function countryRows(state: ZeroSetupState): MemoryRow[] {
  const rowsByCountry = new Map<string, { country_code: string; country: string; node_count: number }>();
  for (const row of activeNonHighMultiplierNodes(state)) {
    const countryCode = String(row.country_code ?? '').trim().toUpperCase();
    if (!countryCode) continue;
    const existing = rowsByCountry.get(countryCode) ?? {
      country_code: countryCode,
      country: String(row.country ?? countryCode),
      node_count: 0,
    };
    existing.node_count += 1;
    rowsByCountry.set(countryCode, existing);
  }
  return [...rowsByCountry.values()].sort((a, b) => b.node_count - a.node_count || a.country_code.localeCompare(b.country_code));
}

function countTaggedNodes(state: ZeroSetupState, args: unknown[]): number {
  const expectedTags = args.slice(1).map((arg) => String(arg).replaceAll('%', '').replaceAll('"', ''));
  return activeNonHighMultiplierNodes(state).filter((row) => {
    const tags = parseTags(row.tags);
    return expectedTags.some((tag) => tags.includes(tag));
  }).length;
}

function activeNonHighMultiplierNodes(state: ZeroSetupState): MemoryRow[] {
  return state.nodes.filter((row) => row.enabled === 1 && !parseTags(row.tags).includes('high-multiplier'));
}

function parseTags(value: unknown): string[] {
  return typeof value === 'string' ? JSON.parse(value) as string[] : [];
}

function groupRow(args: unknown[], isBuiltinInsert: boolean): MemoryRow {
  if (isBuiltinInsert) {
    return {
      id: args[0],
      name: args[1],
      type: args[2],
      collection_ids: '[]',
      group_ids: [],
      builtins: args[3],
      test_url: args[4],
      interval: args[5],
      tolerance: args[6],
      lazy: args[7],
      enabled: 1,
      sort_order: args[8],
      is_builtin: 1,
      created_at: args[9],
      updated_at: args[10],
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
