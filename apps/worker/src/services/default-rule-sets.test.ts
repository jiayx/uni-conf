import { describe, expect, it, vi } from 'vitest';
import { QUIXOTIC_RULE_SET_PRESETS } from '@uni-conf/shared';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';

describe('default remote rule sets', () => {
  it('creates preset rule sets only when no remote rule sets exist', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({ existingCount: 0, inserted });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(QUIXOTIC_RULE_SET_PRESETS.length);
    expect(inserted.find((item) => item.presetId === 'ai')?.targetGroupId).toBe('builtin-ai');
    expect(inserted.find((item) => item.presetId === 'netflix')?.targetGroupId).toBe('builtin-streaming');
    expect(inserted.find((item) => item.presetId === 'adrules')?.targetGroupId).toBe('builtin-reject');
    expect(inserted.find((item) => item.presetId === 'cn')?.targetGroupId).toBe('builtin-direct');
  });

  it('does not recreate defaults after rule sets already exist', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = createMockDb({ existingCount: 1, inserted });

    await ensureDefaultRemoteRuleSets(db, '2026-01-01T00:00:00.000Z');

    expect(inserted).toHaveLength(0);
  });
});

function createMockDb({
  existingCount,
  inserted,
}: {
  existingCount: number;
  inserted: Array<Record<string, unknown>>;
}): D1Database {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('COUNT(*)')) return { count: existingCount };
          return null;
        },
        all: async () => ({ results: listGroups() }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => {
        if (sql.includes('COUNT(*)')) return { count: existingCount };
        return null;
      },
      all: async () => ({ results: listGroups() }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async (statements: Array<{ __args?: unknown[] }>) => {
      for (const statement of statements) {
        const args = statement.__args ?? [];
        inserted.push({
          name: args[1],
          presetId: args[3],
          targetGroupId: args[4],
        });
      }
      return [];
    }),
  } as unknown as D1Database;

  vi.mocked(db.prepare).mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => ({
      __args: args,
      first: async () => {
        if (sql.includes('COUNT(*)')) return { count: existingCount };
        return null;
      },
      all: async () => ({ results: listGroups() }),
      run: async () => ({ success: true }),
      raw: async () => [],
    }),
    first: async () => {
      if (sql.includes('COUNT(*)')) return { count: existingCount };
      return null;
    },
    all: async () => ({ results: listGroups() }),
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
    { id: 'builtin-social', name: 'Social' },
    { id: 'builtin-direct', name: 'DIRECT' },
    { id: 'builtin-reject', name: 'REJECT' },
  ];
}
