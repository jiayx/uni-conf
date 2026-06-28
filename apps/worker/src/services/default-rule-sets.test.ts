import { describe, expect, it, vi } from 'vitest';
import { buildQuixoticRuleSetUrl, inferQuixoticTargetGroup, QUIXOTIC_RULE_SET_PRESETS, resolveQuixoticRuleSetSortOrder } from '@uni-conf/shared';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';

describe('default remote rule sets', () => {
  it('creates missing preset rule sets with template target groups', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({ existingPresets: [], inserted });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(QUIXOTIC_RULE_SET_PRESETS.length + 1);
    expect(inserted.find((item) => item.presetId === 'ai')?.targetGroupId).toBe('builtin-ai');
    expect(inserted.find((item) => item.presetSource === 'uni-conf' && item.presetId === 'telegram')).toMatchObject({
      format: 'text',
      behavior: 'domain',
      targetGroupId: 'builtin-telegram',
      sortOrder: 50,
    });
    expect(inserted.find((item) => item.presetId === 'ai')).toMatchObject({
      behavior: 'classical',
    });
    expect(inserted.find((item) => item.presetId === 'netflix')?.targetGroupId).toBe('builtin-streaming');
    expect(inserted.find((item) => item.presetId === 'gits')?.targetGroupId).toBe('builtin-github');
    expect(inserted.find((item) => item.presetId === 'apple')?.targetGroupId).toBe('builtin-apple');
    expect(inserted.find((item) => item.presetId === 'microsoft')?.targetGroupId).toBe('builtin-microsoft');
    expect(inserted.find((item) => item.presetId === 'adrules')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'httpdns')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'cn')?.targetGroupId).toBe('builtin-direct');
    expect(inserted.find((item) => item.presetId === 'adrules')?.sortOrder).toBe(20);
    expect(inserted.find((item) => item.presetId === 'ai')?.sortOrder).toBe(40);
    expect(inserted.find((item) => item.presetId === 'netflix')?.sortOrder).toBe(60);
  });

  it('does not recreate defaults when preset rule sets already exist with current targets', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: QUIXOTIC_RULE_SET_PRESETS.map((preset) => ({
        id: `preset-${preset.id}`,
        preset_source: 'quixotic',
        preset_id: preset.id,
        url: buildQuixoticRuleSetUrl(preset.id, 'mihomo'),
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: expectedTargetGroupId(preset.id),
        sort_order: resolveQuixoticRuleSetSortOrder(preset.id),
      })).concat({
        id: 'preset-telegram',
        preset_source: 'uni-conf',
        preset_id: 'telegram',
        url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.list',
        format: 'text',
        behavior: 'domain',
        target_group_id: 'builtin-telegram',
        sort_order: 50,
      }),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(0);
  });

  it('retargets existing presets when the active template adds a specific group', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{ id: 'preset-crypto', preset_source: 'quixotic', preset_id: 'crypto', behavior: 'classical', target_group_id: 'builtin-proxy', sort_order: 0 }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      url: buildQuixoticRuleSetUrl('crypto', 'mihomo'),
      format: 'mihomo',
      behavior: 'classical',
      id: 'preset-crypto',
      targetGroupId: 'builtin-crypto',
      sortOrder: 120,
    });
  });

  it('falls back to PROXY when a preset target group is not enabled by the active template', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [
        { id: 'preset-crypto', preset_source: 'quixotic', preset_id: 'crypto', behavior: 'classical', target_group_id: 'builtin-crypto', sort_order: 120 },
        {
          id: 'preset-cn',
          preset_source: 'quixotic',
          preset_id: 'cn',
          url: buildQuixoticRuleSetUrl('cn', 'mihomo'),
          format: 'mihomo',
          behavior: 'classical',
          target_group_id: 'builtin-direct',
          sort_order: 30,
        },
        {
          id: 'preset-adrules',
          preset_source: 'quixotic',
          preset_id: 'adrules',
          url: buildQuixoticRuleSetUrl('adrules', 'mihomo'),
          format: 'mihomo',
          behavior: 'classical',
          target_group_id: 'builtin-reject',
          sort_order: 20,
        },
      ],
      groups: listGroups().filter((group) => !['builtin-crypto', 'builtin-gaming', 'builtin-developer'].includes(group.id)),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      url: buildQuixoticRuleSetUrl('crypto', 'mihomo'),
      format: 'mihomo',
      behavior: 'classical',
      id: 'preset-crypto',
      targetGroupId: 'builtin-proxy',
      sortOrder: 120,
    });
    expect(inserted).not.toContainEqual(expect.objectContaining({ id: 'preset-cn' }));
    expect(inserted).not.toContainEqual(expect.objectContaining({ id: 'preset-adrules' }));
  });

  it('repairs stale Quixotic rule set metadata', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-ai',
        preset_source: 'quixotic',
        preset_id: 'ai',
        url: 'https://example.com/old-ai.list',
        format: 'text',
        behavior: 'domain',
        target_group_id: 'builtin-ai',
        sort_order: 900,
      }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      url: buildQuixoticRuleSetUrl('ai', 'mihomo'),
      format: 'mihomo',
      behavior: 'classical',
      id: 'preset-ai',
      targetGroupId: 'builtin-ai',
      sortOrder: 40,
    });
  });

  it('repairs stale built-in Telegram rule set metadata', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-telegram',
        preset_source: 'uni-conf',
        preset_id: 'telegram',
        url: 'https://example.com/old-telegram.list',
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: 'builtin-proxy',
        sort_order: 900,
      }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      id: 'preset-telegram',
      url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.list',
      format: 'text',
      behavior: 'domain',
      targetGroupId: 'builtin-telegram',
      sortOrder: 50,
    });
  });
});

function createMockDb({
  existingPresets,
  groups = listGroups(),
  inserted,
}: {
  existingPresets: Array<{
    id: string;
    preset_source?: string;
    preset_id: string;
    url?: string;
    format?: string;
    behavior: string;
    target_group_id: string;
    sort_order?: number;
  }>;
  groups?: ReturnType<typeof listGroups>;
  inserted: Array<Record<string, unknown>>;
}): D1Database {
  const remoteRows = existingPresets.map((row) => ({
    preset_source: 'quixotic',
    url: `https://example.com/${row.preset_id}.list`,
    format: 'mihomo',
    ...row,
  }));
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          return null;
        },
        all: async () => ({ results: sql.includes('remote_rule_sets') ? remoteRows : groups }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => {
        return null;
      },
      all: async () => ({ results: sql.includes('remote_rule_sets') ? remoteRows : groups }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async (statements: Array<{ __args?: unknown[] }>) => {
      for (const statement of statements) {
        const args = statement.__args ?? [];
        if (args.length === 7) {
          inserted.push({
            operation: 'update',
            url: args[0],
            format: args[1],
            behavior: args[2],
            targetGroupId: args[3],
            sortOrder: args[4],
            id: args[6],
          });
        } else if (args.length === 12) {
          inserted.push({
            operation: 'insert',
            name: args[1],
            url: args[2],
            format: args[3],
            behavior: args[4],
            presetSource: args[5],
            presetId: args[6],
            targetGroupId: args[7],
            sortOrder: args[8],
          });
        } else {
          inserted.push({
            operation: 'insert',
            name: args[1],
            behavior: 'classical',
            presetSource: 'quixotic',
            presetId: args[3],
            targetGroupId: args[4],
            sortOrder: args[5],
          });
        }
      }
      return [];
    }),
  } as unknown as D1Database;

  vi.mocked(db.prepare).mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => ({
      __args: args,
      first: async () => {
        return null;
      },
      all: async () => ({ results: sql.includes('remote_rule_sets') ? remoteRows : listGroups() }),
      run: async () => ({ success: true }),
      raw: async () => [],
    }),
    first: async () => {
      return null;
    },
    all: async () => ({ results: sql.includes('remote_rule_sets') ? existingPresets : groups }),
    run: async () => ({ success: true }),
    raw: async () => [],
  }) as unknown as D1PreparedStatement);

  return db;
}

function listGroups() {
  return [
    { id: 'builtin-proxy', name: 'PROXY' },
    { id: 'builtin-ai', name: 'AI' },
    { id: 'builtin-streaming', name: 'Streaming' },
    { id: 'builtin-telegram', name: 'Telegram' },
    { id: 'builtin-social', name: 'Social' },
    { id: 'builtin-github', name: 'GitHub' },
    { id: 'builtin-apple', name: 'Apple' },
    { id: 'builtin-microsoft', name: 'Microsoft' },
    { id: 'builtin-crypto', name: 'Crypto' },
    { id: 'builtin-gaming', name: 'Gaming' },
    { id: 'builtin-developer', name: 'Developer' },
    { id: 'builtin-final', name: '漏网之鱼' },
    { id: 'builtin-direct', name: 'DIRECT' },
    { id: 'builtin-reject', name: 'REJECT' },
  ];
}

function expectedTargetGroupId(presetId: string): string {
  const preset = QUIXOTIC_RULE_SET_PRESETS.find((item) => item.id === presetId);
  const target = preset ? inferQuixoticTargetGroup(preset) : 'PROXY';
  const map: Record<string, string> = {
    PROXY: 'builtin-proxy',
    AI: 'builtin-ai',
    Streaming: 'builtin-streaming',
    Telegram: 'builtin-telegram',
    Social: 'builtin-social',
    GitHub: 'builtin-github',
    Apple: 'builtin-apple',
    Microsoft: 'builtin-microsoft',
    Crypto: 'builtin-crypto',
    Gaming: 'builtin-gaming',
    Developer: 'builtin-developer',
    '漏网之鱼': 'builtin-final',
    DIRECT: 'builtin-direct',
    REJECT: 'builtin-reject',
  };
  return map[target] ?? 'builtin-proxy';
}
