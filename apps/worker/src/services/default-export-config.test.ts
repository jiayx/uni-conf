import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_CONFIG_ID, ensureDefaultExportConfig } from './default-export-config';

const createdAt = '2026-01-01T00:00:00.000Z';

describe('default export config', () => {
  it('creates a default Mihomo export config and stores its token', async () => {
    const state = createState();
    const db = createMockDb(state);

    const config = await ensureDefaultExportConfig(db, createdAt);

    expect(config.id).toBe(DEFAULT_EXPORT_CONFIG_ID);
    expect(config.name).toBe('默认 Mihomo 配置');
    expect(config.format).toBe('mihomo');
    expect(config.includeCollectionIds).toEqual([]);
    expect(state.settings.default_export_token).toBe(config.token);
    expect(state.exportConfigs).toHaveLength(1);
  });

  it('reuses the configured default token when the export config exists', async () => {
    const state = createState({
      settings: { default_export_token: 'existing-token' },
      exportConfigs: [makeRow({ token: 'existing-token', name: 'Existing Default' })],
    });
    const db = createMockDb(state);

    const config = await ensureDefaultExportConfig(db, createdAt);

    expect(config.token).toBe('existing-token');
    expect(config.name).toBe('Existing Default');
    expect(state.exportConfigs).toHaveLength(1);
  });

  it('enables an existing built-in default config before using it', async () => {
    const state = createState({
      exportConfigs: [makeRow({ enabled: 0 })],
    });
    const db = createMockDb(state);

    const config = await ensureDefaultExportConfig(db, createdAt);

    expect(config.enabled).toBe(true);
    expect(state.exportConfigs[0]?.enabled).toBe(1);
    expect(state.settings.default_export_token).toBe(config.token);
  });
});

interface TestState {
  settings: { default_export_token: string | null };
  exportConfigs: Record<string, unknown>[];
}

function createState(patch: Partial<TestState> = {}): TestState {
  return {
    settings: { default_export_token: null, ...patch.settings },
    exportConfigs: patch.exportConfigs ?? [],
  };
}

function makeRow(patch: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: DEFAULT_EXPORT_CONFIG_ID,
    name: '默认 Mihomo 配置',
    format: 'mihomo',
    token: 'token',
    enabled: 1,
    include_collection_ids: '[]',
    include_group_ids: '[]',
    include_rule_ids: '[]',
    include_remote_set_ids: '[]',
    extra_config: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...patch,
  };
}

function createMockDb(state: TestState): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => first(sql, args, state),
        run: async () => {
          run(sql, args, state);
          return { success: true };
        },
        all: async () => ({ results: [] }),
        raw: async () => [],
      }),
      first: async () => first(sql, [], state),
      run: async () => {
        run(sql, [], state);
        return { success: true };
      },
      all: async () => ({ results: [] }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}

function first(sql: string, args: unknown[], state: TestState): Record<string, unknown> | null {
  if (sql.includes('SELECT default_export_token')) return state.settings;
  if (sql.includes('WHERE token = ?')) {
    return state.exportConfigs.find((row) => row.token === args[0] && (!sql.includes('enabled = 1') || row.enabled === 1)) ?? null;
  }
  if (sql.includes('WHERE id = ?')) {
    return state.exportConfigs.find((row) => row.id === args[0]) ?? null;
  }
  return null;
}

function run(sql: string, args: unknown[], state: TestState): void {
  if (sql.includes('INSERT OR IGNORE INTO app_settings')) return;
  if (sql.includes('INSERT INTO export_configs')) {
    state.exportConfigs.push(makeRow({
      id: args[0],
      token: args[1],
      created_at: args[2],
      updated_at: args[3],
    }));
    return;
  }
  if (sql.includes('UPDATE app_settings SET default_export_token')) {
    state.settings.default_export_token = String(args[0]);
    return;
  }
  if (sql.includes('UPDATE export_configs SET enabled = 1')) {
    const row = state.exportConfigs.find((item) => item.id === args[1]);
    if (row) {
      row.enabled = 1;
      row.updated_at = args[0];
    }
  }
}
