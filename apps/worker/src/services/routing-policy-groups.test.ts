import { describe, expect, it } from 'vitest';
import {
  applyRoutingPolicyGroupLinks,
  listAutoCollectionKeysById,
  resolveActiveTemplateGroupNames,
  resolveManagedTemplateGroupNames,
  resolveOutletGroupIds,
  resolveRoutingGroupIds,
  syncRoutingPolicyGroups,
  withOutletRefs,
} from './routing-policy-groups';
import {
  FOUNDATION_POLICY_GROUP_NAMES,
  GLOBAL_NODE_OUTLET_GROUP_NAMES,
  isFoundationPolicyGroupId,
  isRuleTargetFoundationGroupId,
  ROUTING_POLICY_TEMPLATES,
  RULE_TARGET_FOUNDATION_GROUP_NAMES,
} from '@uni-conf/shared';

const groupRows = [
  {
    id: 'builtin-proxy',
    name: 'PROXY',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-ai',
    name: 'AI',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-streaming',
    name: 'Streaming',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-github',
    name: 'GitHub',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-telegram',
    name: 'Telegram',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-final',
    name: '漏网之鱼',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-direct',
    name: 'DIRECT',
    type: 'direct',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-reject',
    name: 'REJECT',
    type: 'reject',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-all-nodes',
    name: '全部节点',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-node-select',
    name: '节点选择',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-auto-select',
    name: '自动选择',
    type: 'url-test',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-fallback-select',
    name: '故障切换',
    type: 'fallback',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'us-auto',
    name: '🇺🇸 US Auto',
    type: 'url-test',
    collection_ids: '["collection-us"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'hk-auto',
    name: '🇭🇰 HK Auto',
    type: 'fallback',
    collection_ids: '["collection-hk"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'jp-auto',
    name: '🇯🇵 JP Auto',
    type: 'url-test',
    collection_ids: '["collection-jp"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'sg-auto',
    name: '🇸🇬 SG Auto',
    type: 'url-test',
    collection_ids: '["collection-sg"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'streaming-auto',
    name: 'Streaming Auto',
    type: 'url-test',
    collection_ids: '["collection-streaming"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'native-auto',
    name: 'Native Auto',
    type: 'url-test',
    collection_ids: '["collection-native"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'custom-downloads',
    name: 'Downloads',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'disabled-custom',
    name: 'Disabled Custom',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 0,
    is_builtin: 0,
  },
  {
    id: 'disabled-exit',
    name: 'Disabled Auto',
    type: 'url-test',
    collection_ids: '["collection-disabled"]',
    group_ids: '[]',
    enabled: 0,
    is_builtin: 0,
  },
];

describe('routing policy group sync', () => {
  it('splits fixed rule targets from global node outlets for product surfaces', () => {
    expect([...RULE_TARGET_FOUNDATION_GROUP_NAMES]).toEqual(['PROXY', 'DIRECT', 'REJECT']);
    expect([...GLOBAL_NODE_OUTLET_GROUP_NAMES]).toEqual(['全部节点', '节点选择', '自动选择', '故障切换']);
    expect([...FOUNDATION_POLICY_GROUP_NAMES]).toEqual([
      ...RULE_TARGET_FOUNDATION_GROUP_NAMES,
      ...GLOBAL_NODE_OUTLET_GROUP_NAMES,
    ]);
    expect(isRuleTargetFoundationGroupId('builtin-proxy')).toBe(true);
    expect(isRuleTargetFoundationGroupId('builtin-direct')).toBe(true);
    expect(isRuleTargetFoundationGroupId('builtin-reject')).toBe(true);
    expect(isFoundationPolicyGroupId('builtin-auto-select')).toBe(true);
    expect(isFoundationPolicyGroupId('builtin-ai')).toBe(false);
  });

  it('keeps foundation policy and full-node outlet groups enabled for the empty template', () => {
    const emptyTemplate = ROUTING_POLICY_TEMPLATES.find((template) => template.id === 'empty');

    expect(emptyTemplate).toBeDefined();
    expect([...resolveActiveTemplateGroupNames(emptyTemplate!)]).toEqual([
      'PROXY',
      'DIRECT',
      'REJECT',
      '全部节点',
      '节点选择',
      '自动选择',
      '故障切换',
    ]);
  });

  it.each([
    ['minimal', ['PROXY', 'DIRECT', 'REJECT', '全部节点', '节点选择', '自动选择', '故障切换', '漏网之鱼']],
    [
      'common',
      [
        'PROXY',
        'DIRECT',
        'REJECT',
        '全部节点',
        '节点选择',
        '自动选择',
        '故障切换',
        'AI',
        'STREAMING',
        'TELEGRAM',
        'SOCIAL',
        'GITHUB',
        'GOOGLE',
        'APPLE',
        'MICROSOFT',
        '漏网之鱼',
      ],
    ],
    [
      'ai',
      [
        'PROXY',
        'DIRECT',
        'REJECT',
        '全部节点',
        '节点选择',
        '自动选择',
        '故障切换',
        'AI',
        'GITHUB',
        'GOOGLE',
        'DEVELOPER',
        'APPLE',
        'MICROSOFT',
        '漏网之鱼',
      ],
    ],
    [
      'streaming',
      [
        'PROXY',
        'DIRECT',
        'REJECT',
        '全部节点',
        '节点选择',
        '自动选择',
        '故障切换',
        'STREAMING',
        'TELEGRAM',
        'SOCIAL',
        'APPLE',
        'MICROSOFT',
        '漏网之鱼',
      ],
    ],
    [
      'router',
      [
        'PROXY',
        'DIRECT',
        'REJECT',
        '全部节点',
        '节点选择',
        '自动选择',
        '故障切换',
        'STREAMING',
        'TELEGRAM',
        'GITHUB',
        'GOOGLE',
        'APPLE',
        'MICROSOFT',
        '漏网之鱼',
      ],
    ],
    [
      'extended',
      [
        'PROXY',
        'DIRECT',
        'REJECT',
        '全部节点',
        '节点选择',
        '自动选择',
        '故障切换',
        'AI',
        'STREAMING',
        'TELEGRAM',
        'SOCIAL',
        'GITHUB',
        'GOOGLE',
        'APPLE',
        'MICROSOFT',
        '漏网之鱼',
        'CRYPTO',
        'GAMING',
        'DEVELOPER',
      ],
    ],
  ])('resolves the %s scenario template with foundation outlets', (templateId, groupNames) => {
    const template = ROUTING_POLICY_TEMPLATES.find((item) => item.id === templateId);

    expect(template).toBeDefined();
    expect([...resolveActiveTemplateGroupNames(template!)]).toEqual(groupNames);
  });

  it('keeps DNS recommendations tied to scenario templates', () => {
    expect(
      ROUTING_POLICY_TEMPLATES.map((template) => [template.id, template.recommendedDnsMode])
    ).toEqual([
      ['empty', 'smart'],
      ['minimal', 'smart'],
      ['common', 'smart'],
      ['ai', 'smart'],
      ['streaming', 'smart'],
      ['router', 'compatible'],
      ['extended', 'smart'],
    ]);
  });

  it('normalizes foundation outlet builtins to the canonical model', async () => {
    const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
    const db = createSyncMockDb(batches);

    await syncRoutingPolicyGroups(db, '2026-01-01T00:00:00.000Z');

    const insertedGroups = batches
      .flat()
      .filter((statement) => statement.sql.includes('INSERT OR IGNORE INTO groups'));
    const byId = new Map(insertedGroups.map((statement) => [statement.args[0], statement.args]));
    const normalizedGroups = batches
      .flat()
      .filter((statement) => statement.sql.includes('UPDATE groups SET') && statement.sql.includes('builtins = ?'));
    const normalizedById = new Map(normalizedGroups.map((statement) => [statement.args[10], statement.args]));

    expect(byId.get('builtin-proxy')?.[4]).toBe('[]');
    expect(byId.get('builtin-direct')?.[4]).toBe('["DIRECT"]');
    expect(byId.get('builtin-reject')?.[4]).toBe('["REJECT"]');
    expect(normalizedById.get('builtin-proxy')?.[3]).toBe('[]');
    expect(normalizedById.get('builtin-direct')?.[3]).toBe('["DIRECT"]');
    expect(normalizedById.get('builtin-reject')?.[3]).toBe('["REJECT"]');
  });

  it('manages every generated foundation and business group through templates', () => {
    expect([...resolveManagedTemplateGroupNames()]).toEqual([
      'PROXY',
      'DIRECT',
      'REJECT',
      '全部节点',
      '节点选择',
      '自动选择',
      '故障切换',
      '漏网之鱼',
      'AI',
      'STREAMING',
      'TELEGRAM',
      'SOCIAL',
      'GITHUB',
      'GOOGLE',
      'APPLE',
      'MICROSOFT',
      'DEVELOPER',
      'CRYPTO',
      'GAMING',
    ]);
  });

  it('resolves default and node-backed groups as outlet groups', () => {
    expect(resolveOutletGroupIds(groupRows)).toEqual([
      'builtin-proxy',
      'builtin-direct',
      'builtin-reject',
      'builtin-all-nodes',
      'builtin-node-select',
      'builtin-auto-select',
      'builtin-fallback-select',
      'us-auto',
      'hk-auto',
      'jp-auto',
      'sg-auto',
      'streaming-auto',
      'native-auto',
    ]);
  });

  it('resolves builtin and custom non-node select groups as routing policy groups', () => {
    expect(resolveRoutingGroupIds(groupRows)).toEqual([
      'builtin-proxy',
      'builtin-ai',
      'builtin-streaming',
      'builtin-github',
      'builtin-telegram',
      'builtin-final',
      'custom-downloads',
    ]);
  });

  it('links every routing policy group to foundation and node outlet groups for preview/export', () => {
    const rows = applyRoutingPolicyGroupLinks(groupRows);
    const routingGroupIds = [
      'builtin-proxy',
      'builtin-ai',
      'builtin-streaming',
      'builtin-github',
      'builtin-telegram',
      'builtin-final',
      'custom-downloads',
    ];

    expect(rows.find((row) => row.id === 'builtin-proxy')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto","streaming-auto","native-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-ai')?.group_ids).toBe(
      '["native-auto","us-auto","jp-auto","sg-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","hk-auto","streaming-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-streaming')?.group_ids).toBe(
      '["streaming-auto","native-auto","hk-auto","jp-auto","sg-auto","us-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject"]'
    );
    expect(rows.find((row) => row.id === 'builtin-github')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto","streaming-auto","native-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-telegram')?.group_ids).toBe(
      '["sg-auto","hk-auto","jp-auto","us-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","streaming-auto","native-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-final')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto","streaming-auto","native-auto"]'
    );
    expect(rows.find((row) => row.id === 'custom-downloads')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto","streaming-auto","native-auto"]'
    );
    for (const id of routingGroupIds) {
      const groupIds = JSON.parse(String(rows.find((row) => row.id === id)?.group_ids ?? '[]')) as string[];
      expect(groupIds).toContain('builtin-direct');
      expect(groupIds).toContain('builtin-reject');
    }
    expect(rows.find((row) => row.id === 'disabled-custom')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'builtin-direct')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'builtin-reject')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'builtin-all-nodes')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'us-auto')?.group_ids).toBe('[]');
  });

  it('keeps system-managed outlet candidates but moves the preferred outlet first', () => {
    const rows = applyRoutingPolicyGroupLinks(
      groupRows,
      {
        'builtin-ai': 'auto:country:SG:url-test',
        'builtin-streaming': 'auto:country:JP:url-test',
      },
      {
        'collection-us': 'country:US:url-test',
        'collection-jp': 'country:JP:url-test',
        'collection-sg': 'country:SG:url-test',
      }
    );

    expect(JSON.parse(String(rows.find((row) => row.id === 'builtin-ai')?.group_ids ?? '[]')).slice(0, 4)).toEqual([
      'sg-auto',
      'native-auto',
      'us-auto',
      'jp-auto',
    ]);
    expect(JSON.parse(String(rows.find((row) => row.id === 'builtin-streaming')?.group_ids ?? '[]')).slice(0, 4)).toEqual([
      'jp-auto',
      'streaming-auto',
      'native-auto',
      'hk-auto',
    ]);
  });

  it('resolves stable automatic outlet references after generated group ids change', () => {
    const regeneratedRows = groupRows.map((row) => (
      row.id === 'us-auto'
        ? { ...row, id: 'new-us-auto-id' }
        : row
    ));
    const rows = applyRoutingPolicyGroupLinks(
      regeneratedRows,
      { 'builtin-ai': 'auto:country:US:url-test' },
      { 'collection-us': 'country:US:url-test' }
    );

    const aiGroupIds = JSON.parse(String(rows.find((row) => row.id === 'builtin-ai')?.group_ids ?? '[]')) as string[];
    expect(aiGroupIds[0]).toBe('new-us-auto-id');
  });

  it('exposes stable outlet refs for generated automatic node groups', () => {
    const rows = withOutletRefs(groupRows, {
      'collection-us': 'country:US:url-test',
      'collection-streaming': 'tag:streaming:url-test',
    });

    expect(outletRef(rows, 'us-auto')).toBe('auto:country:US:url-test');
    expect(outletRef(rows, 'streaming-auto')).toBe('auto:tag:streaming:url-test');
    expect(outletRef(rows, 'builtin-auto-select')).toBe('group:builtin-auto-select');
  });

  it('normalizes automatic collection keys from managed notes', async () => {
    await expect(listAutoCollectionKeysById(createAutoCollectionKeyDb([
      { id: 'collection-us', notes: '[uni-conf:auto-node-group] country:us:url-test' },
      { id: 'collection-streaming', notes: '[uni-conf:auto-node-group] tag:streaming:fallback' },
      { id: 'collection-invalid', notes: '[uni-conf:auto-node-group] US:url-test' },
    ]))).resolves.toEqual({
      'collection-us': 'country:US:url-test',
      'collection-streaming': 'tag:streaming:fallback',
    });
  });
});

function outletRef(rows: Array<Record<string, unknown>>, id: string): unknown {
  return rows.find((row) => row.id === id)?.outlet_ref;
}

function createAutoCollectionKeyDb(rows: Array<{ id: string; notes: string | null }>): D1Database {
  return {
    prepare: () => ({
      all: async () => ({ results: rows }),
      bind: () => ({
        all: async () => ({ results: rows }),
      }),
    }),
  } as unknown as D1Database;
}

function createSyncMockDb(batches: Array<Array<{ sql: string; args: unknown[] }>>): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        first: async () => sql.includes('SELECT * FROM app_settings') ? appSettingsRow() : null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => sql.includes('SELECT * FROM app_settings') ? appSettingsRow() : null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    }),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
}

function appSettingsRow() {
  return {
    language: 'zh',
    theme: 'system',
    routing_policy_template: 'empty',
    routing_outlet_preferences: null,
    dns_mode: 'smart',
    export_node_naming_mode: 'smart',
    show_compatibility_warnings: 1,
    enable_auto_refresh: 1,
    auto_refresh_interval: 1440,
    auto_node_groups_enabled: 1,
    auto_node_group_types: '["url-test"]',
    auto_node_group_keys: null,
    auto_node_group_include_flag: 1,
  };
}
