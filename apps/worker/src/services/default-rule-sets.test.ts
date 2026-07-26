import { describe, expect, it, vi } from 'vitest';
import { buildQuixoticRuleSetUrl, inferQuixoticTargetGroup, QUIXOTIC_RULE_SET_PRESETS, resolveQuixoticRuleSetBehavior, resolveQuixoticRuleSetSortOrder } from '@uni-conf/shared';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';

const SYSTEM_DISABLED_NOTE = '[uni-conf:auto-disabled:missing-target]';

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
    expect(inserted.find((item) => item.presetId === 'fake-ip-filter')).toMatchObject({
      url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/master/custom/domain/fake-ip-filter.list',
      behavior: 'domain',
      targetGroupId: 'builtin-direct',
    });
    expect(inserted.find((item) => item.presetId === 'netflix')?.targetGroupId).toBe('builtin-streaming');
    expect(inserted.find((item) => item.presetId === 'gits')?.targetGroupId).toBe('builtin-github');
    expect(inserted.find((item) => item.presetId === 'google')?.targetGroupId).toBe('builtin-google');
    expect(inserted.find((item) => item.presetId === 'googlefcm')?.targetGroupId).toBe('builtin-google');
    expect(inserted.find((item) => item.presetId === 'apple')?.targetGroupId).toBe('builtin-apple');
    expect(inserted.find((item) => item.presetId === 'microsoft')?.targetGroupId).toBe('builtin-microsoft');
    expect(inserted.find((item) => item.presetId === 'steam')?.targetGroupId).toBe('builtin-gaming');
    expect(inserted.find((item) => item.presetId === 'adrules')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'httpdns')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'cn')?.targetGroupId).toBe('builtin-direct');
    expect(inserted.find((item) => item.presetId === 'adrules')?.sortOrder).toBe(20);
    expect(inserted.find((item) => item.presetId === 'ai')?.sortOrder).toBe(40);
    expect(inserted.find((item) => item.presetId === 'netflix')?.sortOrder).toBe(60);
    expect(inserted.find((item) => item.presetId === 'steam')?.sortOrder).toBe(110);
  });

  it('keeps managed rule set sort order aligned with the default routing pipeline', () => {
    const orderedPresetIds = [
      'private',
      'adrules',
      'cn',
      'ai',
      'telegram',
      'netflix',
      'gits',
      'apple',
      'microsoft',
      'google',
      'steam',
      'crypto',
      'socialmedia',
      'proxy',
      'ecommerce',
    ];

    const orders = orderedPresetIds.map(resolveQuixoticRuleSetSortOrder);

    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(Object.fromEntries(orderedPresetIds.map((id) => [id, resolveQuixoticRuleSetSortOrder(id)]))).toEqual({
      private: 10,
      adrules: 20,
      cn: 30,
      ai: 40,
      telegram: 50,
      netflix: 60,
      gits: 70,
      apple: 80,
      microsoft: 90,
      google: 100,
      steam: 110,
      crypto: 120,
      socialmedia: 130,
      proxy: 140,
      ecommerce: 150,
    });
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
        behavior: resolveQuixoticRuleSetBehavior(preset.id),
        target_group_id: expectedTargetGroupId(preset.id),
        enabled: 1,
        sort_order: resolveQuixoticRuleSetSortOrder(preset.id),
      })).concat({
        id: 'preset-telegram',
        preset_source: 'uni-conf',
        preset_id: 'telegram',
        url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.list',
        format: 'text',
        behavior: 'domain',
        target_group_id: 'builtin-telegram',
        enabled: 1,
        sort_order: 50,
      }),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(0);
  });

  it('reenables and retargets system-disabled presets when the active template adds a specific group', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-crypto',
        preset_source: 'quixotic',
        preset_id: 'crypto',
        behavior: 'classical',
        target_group_id: 'builtin-proxy',
        enabled: 0,
        notes: `QuixoticHeart/rule-set:crypto old\n${SYSTEM_DISABLED_NOTE}`,
        sort_order: 0,
      }],
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
      enabled: 1,
      sortOrder: 120,
      notes: expect.not.stringContaining(SYSTEM_DISABLED_NOTE),
    });
  });

  it('does not reenable user-disabled managed presets when metadata is already current', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-crypto',
        preset_source: 'quixotic',
        preset_id: 'crypto',
        url: buildQuixoticRuleSetUrl('crypto', 'mihomo'),
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: 'builtin-crypto',
        enabled: 0,
        notes: 'QuixoticHeart/rule-set:crypto 加密货币相关规则，包含 Binance、OKX、Bybit、Bitget 等',
        sort_order: 120,
      }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).not.toContainEqual(expect.objectContaining({
      operation: 'update',
      id: 'preset-crypto',
      enabled: 1,
    }));
    expect(inserted).not.toContainEqual(expect.objectContaining({
      operation: 'insert',
      presetId: 'crypto',
    }));
  });

  it('disables managed rule sets whose business target is not enabled by the active template', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [
        { id: 'preset-crypto', preset_source: 'quixotic', preset_id: 'crypto', behavior: 'classical', target_group_id: 'builtin-crypto', enabled: 1, sort_order: 120 },
        {
          id: 'preset-cn',
          preset_source: 'quixotic',
          preset_id: 'cn',
          url: buildQuixoticRuleSetUrl('cn', 'mihomo'),
          format: 'mihomo',
          behavior: 'classical',
          target_group_id: 'builtin-direct',
          enabled: 1,
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
          enabled: 1,
          sort_order: 20,
        },
      ],
      groups: listGroups().filter((group) => !['builtin-crypto', 'builtin-gaming', 'builtin-developer'].includes(group.id)),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'disable',
      id: 'preset-crypto',
      notes: expect.stringContaining(SYSTEM_DISABLED_NOTE),
    });
    expect(inserted).not.toContainEqual(expect.objectContaining({ id: 'preset-cn' }));
    expect(inserted).not.toContainEqual(expect.objectContaining({ id: 'preset-adrules' }));
    expect(inserted).not.toContainEqual(expect.objectContaining({ presetId: 'crypto', operation: 'insert' }));
  });

  it('creates missing managed rule sets as system-disabled rows when the target group is currently disabled', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [],
      groups: listGroups().map((group) => (
        ['builtin-crypto', 'builtin-gaming', 'builtin-developer'].includes(group.id)
          ? { ...group, enabled: 0 }
          : group
      )),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    for (const [presetId, targetGroupId] of [
      ['crypto', 'builtin-crypto'],
      ['steam', 'builtin-gaming'],
    ]) {
      expect(inserted).toContainEqual(expect.objectContaining({
        operation: 'insert',
        presetId,
        targetGroupId,
        enabled: 0,
        notes: expect.stringContaining(SYSTEM_DISABLED_NOTE),
      }));
    }
    expect(inserted.find((item) => item.presetId === 'adrules')).toMatchObject({
      targetGroupId: 'builtin-reject',
      enabled: 1,
    });
    expect(inserted.find((item) => item.presetId === 'cn')).toMatchObject({
      targetGroupId: 'builtin-direct',
      enabled: 1,
    });
    expect(inserted.find((item) => item.presetId === 'games')).toMatchObject({
      targetGroupId: 'builtin-proxy',
      enabled: 1,
    });
    expect(inserted.find((item) => item.presetId === 'gits')).toMatchObject({
      targetGroupId: 'builtin-github',
      enabled: 1,
    });
  });

  it('preserves user-disabled managed rule sets when their target group is disabled by the template', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-crypto',
        preset_source: 'quixotic',
        preset_id: 'crypto',
        url: buildQuixoticRuleSetUrl('crypto', 'mihomo'),
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: 'builtin-crypto',
        enabled: 0,
        notes: 'user disabled this one',
        sort_order: 120,
      }],
      groups: listGroups().map((group) => group.id === 'builtin-crypto' ? { ...group, enabled: 0 } : group),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).not.toContainEqual(expect.objectContaining({
      id: 'preset-crypto',
      notes: expect.stringContaining(SYSTEM_DISABLED_NOTE),
    }));
    expect(inserted).not.toContainEqual(expect.objectContaining({
      id: 'preset-crypto',
      enabled: 1,
    }));
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
        enabled: 1,
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
      enabled: 1,
      sortOrder: 40,
      notes: 'QuixoticHeart/rule-set:ai AI 规则集合，包含 OpenAI、Gemini、Copilot、Claude 等',
    });
    expect(inserted).toContainEqual({ operation: 'invalidate-health', id: 'preset-ai' });
  });

  it('keeps source health when only managed routing metadata changes', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-ai',
        preset_source: 'quixotic',
        preset_id: 'ai',
        url: buildQuixoticRuleSetUrl('ai', 'mihomo'),
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: 'builtin-proxy',
        enabled: 1,
        sort_order: 900,
      }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual(expect.objectContaining({ operation: 'update', id: 'preset-ai' }));
    expect(inserted).not.toContainEqual({ operation: 'invalidate-health', id: 'preset-ai' });
  });

  it('repairs fake-ip-filter away from the nonexistent generic Quixotic path', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{
        id: 'preset-fake-ip-filter',
        preset_source: 'quixotic',
        preset_id: 'fake-ip-filter',
        url: 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/fake-ip-filter.list',
        format: 'mihomo',
        behavior: 'classical',
        target_group_id: 'builtin-direct',
        enabled: 1,
        sort_order: 30,
      }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/master/custom/domain/fake-ip-filter.list',
      format: 'mihomo',
      behavior: 'domain',
      id: 'preset-fake-ip-filter',
      targetGroupId: 'builtin-direct',
      enabled: 1,
      sortOrder: 30,
      notes: 'QuixoticHeart/rule-set:fake-ip-filter fake-ip 过滤黑名单',
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
        enabled: 1,
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
      enabled: 1,
      sortOrder: 50,
      notes: 'UniConf built-in: MetaCubeX/meta-rules-dat geosite telegram domain list',
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
    enabled?: number;
    sort_order?: number;
    notes?: string;
  }>;
  groups?: ReturnType<typeof listGroups>;
  inserted: Array<Record<string, unknown>>;
}): D1Database {
  const remoteRows = existingPresets.map((row) => ({
    preset_source: 'quixotic',
    url: `https://example.com/${row.preset_id}.list`,
    format: 'mihomo',
    notes: canonicalPresetNotes(row.preset_source ?? 'quixotic', row.preset_id),
    ...row,
  }));
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: () => ({
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
    batch: vi.fn(async (statements: Array<{ __args?: unknown[]; __sql?: string }>) => {
      for (const statement of statements) {
        const args = statement.__args ?? [];
        const sql = statement.__sql ?? '';
        if (sql.includes('DELETE FROM remote_rule_set_source_health')) {
          inserted.push({ operation: 'invalidate-health', id: args[0] });
        } else if (sql.includes('SET enabled = 0')) {
          inserted.push({
            operation: 'disable',
            notes: args[0],
            id: args[2],
          });
        } else if (sql.includes('UPDATE remote_rule_sets SET')) {
          inserted.push({
            operation: 'update',
            url: args[0],
            format: args[1],
            behavior: args[2],
            targetGroupId: args[3],
            enabled: args[4],
            sortOrder: args[5],
            notes: args[6],
            id: args[8],
          });
        } else if (sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, 24')) {
          inserted.push({
            operation: 'insert',
            name: args[1],
            url: args[2],
            format: args[3],
            behavior: args[4],
            presetSource: args[5],
            presetId: args[6],
            targetGroupId: args[7],
            enabled: args[8],
            sortOrder: args[9],
            notes: args[10],
          });
        } else {
          inserted.push({
            operation: 'insert',
            name: args[1],
            url: args[2],
            behavior: args[3],
            presetSource: 'quixotic',
            presetId: args[4],
            targetGroupId: args[5],
            enabled: args[6],
            sortOrder: args[7],
            notes: args[8],
          });
        }
      }
      return [];
    }),
  } as unknown as D1Database;

  vi.mocked(db.prepare).mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => ({
      __args: args,
      __sql: sql,
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
  }) as unknown as D1PreparedStatement);

  return db;
}

function canonicalPresetNotes(source: string, presetId: string): string {
  if (source === 'uni-conf' && presetId === 'telegram') {
    return 'UniConf built-in: MetaCubeX/meta-rules-dat geosite telegram domain list';
  }
  const preset = QUIXOTIC_RULE_SET_PRESETS.find((item) => item.id === presetId);
  return preset ? `QuixoticHeart/rule-set:${preset.id} ${preset.description}` : '';
}

function listGroups() {
  return [
    { id: 'builtin-proxy', name: 'PROXY', enabled: 1 },
    { id: 'builtin-ai', name: 'AI', enabled: 1 },
    { id: 'builtin-streaming', name: 'Streaming', enabled: 1 },
    { id: 'builtin-telegram', name: 'Telegram', enabled: 1 },
    { id: 'builtin-social', name: 'Social', enabled: 1 },
    { id: 'builtin-github', name: 'GitHub', enabled: 1 },
    { id: 'builtin-google', name: 'Google', enabled: 1 },
    { id: 'builtin-apple', name: 'Apple', enabled: 1 },
    { id: 'builtin-microsoft', name: 'Microsoft', enabled: 1 },
    { id: 'builtin-crypto', name: 'Crypto', enabled: 1 },
    { id: 'builtin-gaming', name: 'Gaming', enabled: 1 },
    { id: 'builtin-developer', name: 'Developer', enabled: 1 },
    { id: 'builtin-final', name: '漏网之鱼', enabled: 1 },
    { id: 'builtin-direct', name: 'DIRECT', enabled: 1 },
    { id: 'builtin-reject', name: 'REJECT', enabled: 1 },
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
    Google: 'builtin-google',
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
