import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@uni-conf/types';
import { buildAutoNodeGroupPlans, syncAutoNodeGroups } from './auto-node-groups';
import { getAppSettings } from './app-settings';
import { syncRoutingPolicyGroups } from './routing-policy-groups';

vi.mock('./app-settings', () => ({
  getAppSettings: vi.fn(),
}));

vi.mock('./routing-policy-groups', () => ({
  syncRoutingPolicyGroups: vi.fn(),
}));

describe('auto node groups', () => {
  beforeEach(() => {
    vi.mocked(getAppSettings).mockReset();
    vi.mocked(syncRoutingPolicyGroups).mockReset();
  });

  it('builds country and tag-backed auto node group plans', () => {
    const plans = buildAutoNodeGroupPlans(
      [
        { countryCode: 'US', country: 'United States' },
        { countryCode: 'HK', country: 'Hong Kong' },
      ],
      ['streaming', 'native']
    );

    expect(plans).toEqual([
      {
        key: 'country:US:url-test',
        name: '🇺🇸 US Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] country:US:url-test',
        filters: [
          { id: 'auto-country-us', field: 'countryCode', operator: 'equals', value: 'US', enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'country:HK:url-test',
        name: '🇭🇰 HK Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] country:HK:url-test',
        filters: [
          { id: 'auto-country-hk', field: 'countryCode', operator: 'equals', value: 'HK', enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'tag:streaming:url-test',
        name: 'Streaming Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] tag:streaming:url-test',
        filters: [
          { id: 'auto-tag-streaming', field: 'tag', operator: 'in', value: ['streaming', 'unlock'], enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'tag:native:url-test',
        name: 'Native Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] tag:native:url-test',
        filters: [
          { id: 'auto-tag-native', field: 'tag', operator: 'in', value: ['residential', 'native-ip'], enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
    ]);
  });

  it('builds selected policy types without old marker formats', () => {
    const plans = buildAutoNodeGroupPlans(
      [{ countryCode: 'US', country: 'United States' }],
      [],
      ['select', 'fallback'],
      false
    );

    expect(plans.map((plan) => [plan.key, plan.name, plan.type, plan.markerText])).toEqual([
      ['country:US:select', 'US Select', 'select', '[uni-conf:auto-node-group] country:US:select'],
      ['country:US:fallback', 'US Fallback', 'fallback', '[uni-conf:auto-node-group] country:US:fallback'],
    ]);
  });

  it('removes generated collections when auto node groups are disabled', async () => {
    vi.mocked(getAppSettings).mockResolvedValue(makeSettings({
      autoNodeGroupsEnabled: false,
      autoNodeGroupTypes: ['url-test'],
    }));
    const db = createMockDb({
      autoCollections: [
        { id: 'collection-us', notes: '[uni-conf:auto-node-group] country:US:url-test' },
        { id: 'collection-streaming', notes: '[uni-conf:auto-node-group] tag:streaming:url-test' },
      ],
    });

    await syncAutoNodeGroups(db, '2026-01-01T00:00:00.000Z');

    expect(db.operations).toContainEqual({
      operation: 'delete-groups',
      collectionIds: '["collection-us"]',
    });
    expect(db.operations).toContainEqual({
      operation: 'delete-collection',
      id: 'collection-us',
    });
    expect(db.operations).toContainEqual({
      operation: 'delete-collection',
      id: 'collection-streaming',
    });
    expect(syncRoutingPolicyGroups).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z');
  });

  it('keeps selected select and fallback auto groups instead of deleting non-url-test groups', async () => {
    vi.mocked(getAppSettings).mockResolvedValue(makeSettings({
      autoNodeGroupTypes: ['select', 'fallback'],
      autoNodeGroupKeys: ['country:US:select', 'country:US:fallback'],
      autoNodeGroupIncludeFlag: false,
    }));
    const db = createMockDb({
      countries: [{ country_code: 'US', country: 'United States', node_count: 2 }],
      autoCollections: [
        { id: 'collection-us-select', notes: '[uni-conf:auto-node-group] country:US:select' },
        { id: 'collection-us-fallback', notes: '[uni-conf:auto-node-group] country:US:fallback' },
      ],
      linkedGroups: {
        '["collection-us-select"]': 'group-us-select',
        '["collection-us-fallback"]': 'group-us-fallback',
      },
    });

    await syncAutoNodeGroups(db, '2026-01-01T00:00:00.000Z');

    expect(db.operations.filter((item) => String(item.operation).startsWith('delete'))).toEqual([]);
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'update-group',
      id: 'group-us-select',
      name: 'US Select',
      type: 'select',
    }));
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'update-group',
      id: 'group-us-fallback',
      name: 'US Fallback',
      type: 'fallback',
    }));
  });
});

function makeSettings(patch: Partial<AppSettings>): AppSettings {
  return {
    language: 'zh',
    theme: 'system',
    routingPolicyTemplate: 'common',
    dnsMode: 'smart',
    exportNodeNamingMode: 'smart',
    showCompatibilityWarnings: true,
    enableAutoRefresh: true,
    autoRefreshInterval: 1440,
    autoNodeGroupsEnabled: true,
    autoNodeGroupTypes: ['url-test'],
    autoNodeGroupIncludeFlag: true,
    ...patch,
  };
}

function createMockDb({
  countries = [],
  autoCollections = [],
  linkedGroups = {},
}: {
  countries?: Array<{ country_code: string; country: string | null; node_count: number }>;
  autoCollections?: Array<{ id: string; notes: string | null }>;
  linkedGroups?: Record<string, string>;
}) {
  const operations: Array<Record<string, unknown>> = [];
  const db = {
    operations,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes('FROM collections WHERE notes LIKE')) {
            return { results: autoCollections };
          }
          if (sql.includes('GROUP BY country_code')) {
            return { results: countries };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql.includes('COUNT(*) AS node_count')) return { node_count: 0 };
          if (sql.includes('SELECT id FROM groups WHERE is_builtin = 0')) {
            const collectionIds = String(args[0]);
            const id = linkedGroups[collectionIds];
            return id ? { id } : null;
          }
          if (sql.includes('SELECT MAX(sort_order)')) return { max_order: 10 };
          return null;
        },
        run: async () => {
          operations.push(operationFromSql(sql, args));
          return { success: true };
        },
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
    })),
  };
  return db as unknown as D1Database & { operations: Array<Record<string, unknown>> };
}

function operationFromSql(sql: string, args: unknown[]): Record<string, unknown> {
  if (sql.startsWith('DELETE FROM groups')) {
    return { operation: 'delete-groups', collectionIds: args[0] };
  }
  if (sql.startsWith('DELETE FROM collections')) {
    return { operation: 'delete-collection', id: args[0] };
  }
  if (sql.startsWith('UPDATE collections')) {
    return { operation: 'update-collection', name: args[0], id: args[4] };
  }
  if (sql.startsWith('UPDATE groups')) {
    return { operation: 'update-group', name: args[0], type: args[1], collectionIds: args[2], id: args[8] };
  }
  if (sql.startsWith('INSERT INTO collections')) {
    return { operation: 'insert-collection', id: args[0], name: args[1] };
  }
  if (sql.startsWith('INSERT INTO groups')) {
    return { operation: 'insert-group', id: args[0], name: args[1], type: args[2] };
  }
  return { operation: 'run', sql, args };
}
