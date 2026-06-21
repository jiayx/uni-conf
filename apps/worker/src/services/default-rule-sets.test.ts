import { describe, expect, it, vi } from 'vitest';
import { inferQuixoticTargetGroup, QUIXOTIC_RULE_SET_PRESETS } from '@uni-conf/shared';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';

describe('default remote rule sets', () => {
  it('creates missing preset rule sets with template target groups', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({ existingPresets: [], inserted });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(QUIXOTIC_RULE_SET_PRESETS.length);
    expect(inserted.find((item) => item.presetId === 'ai')?.targetGroupId).toBe('builtin-ai');
    expect(inserted.find((item) => item.presetId === 'netflix')?.targetGroupId).toBe('builtin-streaming');
    expect(inserted.find((item) => item.presetId === 'gits')?.targetGroupId).toBe('builtin-github');
    expect(inserted.find((item) => item.presetId === 'apple')?.targetGroupId).toBe('builtin-apple');
    expect(inserted.find((item) => item.presetId === 'microsoft')?.targetGroupId).toBe('builtin-microsoft');
    expect(inserted.find((item) => item.presetId === 'adrules')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'cn')?.targetGroupId).toBe('builtin-direct');
  });

  it('does not recreate defaults when preset rule sets already exist with current targets', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: QUIXOTIC_RULE_SET_PRESETS.map((preset) => ({
        id: `preset-${preset.id}`,
        preset_id: preset.id,
        target_group_id: expectedTargetGroupId(preset.id),
      })),
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(0);
  });

  it('retargets existing presets when the active template adds a specific group', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({
      existingPresets: [{ id: 'preset-crypto', preset_id: 'crypto', target_group_id: 'builtin-proxy' }],
      inserted,
    });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toContainEqual({
      operation: 'update',
      id: 'preset-crypto',
      targetGroupId: 'builtin-crypto',
    });
  });
});

function createMockDb({
  existingPresets,
  inserted,
}: {
  existingPresets: Array<{ id: string; preset_id: string; target_group_id: string }>;
  inserted: Array<Record<string, unknown>>;
}): D1Database {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          return null;
        },
        all: async () => ({ results: sql.includes('remote_rule_sets') ? existingPresets : listGroups() }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => {
        return null;
      },
      all: async () => ({ results: sql.includes('remote_rule_sets') ? existingPresets : listGroups() }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async (statements: Array<{ __args?: unknown[] }>) => {
      for (const statement of statements) {
        const args = statement.__args ?? [];
        if (args.length === 3) {
          inserted.push({ operation: 'update', targetGroupId: args[0], id: args[2] });
        } else {
          inserted.push({
            operation: 'insert',
            name: args[1],
            presetId: args[3],
            targetGroupId: args[4],
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
      all: async () => ({ results: sql.includes('remote_rule_sets') ? existingPresets : listGroups() }),
      run: async () => ({ success: true }),
      raw: async () => [],
    }),
    first: async () => {
      return null;
    },
    all: async () => ({ results: sql.includes('remote_rule_sets') ? existingPresets : listGroups() }),
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
