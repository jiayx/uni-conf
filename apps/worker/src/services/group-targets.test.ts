import { describe, expect, it, vi } from 'vitest';
import { isEnabledTargetGroup, listEnabledTargetGroupIds } from './group-targets';

describe('group target helpers', () => {
  it('recognizes only enabled non-node groups as valid rule targets', async () => {
    const db = createMockDb([
      { id: 'builtin-proxy', enabled: 1, collection_ids: '[]' },
      { id: 'us-auto', enabled: 1, collection_ids: '["collection-us"]' },
      { id: 'builtin-crypto', enabled: 0, collection_ids: '[]' },
    ]);

    await expect(isEnabledTargetGroup(db, 'builtin-proxy')).resolves.toBe(true);
    await expect(isEnabledTargetGroup(db, 'us-auto')).resolves.toBe(false);
    await expect(isEnabledTargetGroup(db, 'builtin-crypto')).resolves.toBe(false);
    await expect(isEnabledTargetGroup(db, 'missing')).resolves.toBe(false);
  });

  it('lists enabled non-node target group ids', async () => {
    const db = createMockDb([
      { id: 'builtin-proxy', enabled: 1, collection_ids: '[]' },
      { id: 'builtin-direct', enabled: 1, collection_ids: '[]' },
      { id: 'us-auto', enabled: 1, collection_ids: '["collection-us"]' },
      { id: 'builtin-crypto', enabled: 0, collection_ids: '[]' },
    ]);

    await expect(listEnabledTargetGroupIds(db)).resolves.toEqual(new Set(['builtin-proxy', 'builtin-direct']));
  });
});

function createMockDb(groups: Array<{ id: string; enabled: number; collection_ids: string | null }>): D1Database {
  const isRuleTarget = (group: { enabled: number; collection_ids: string | null }) =>
    group.enabled === 1 && (!group.collection_ids || group.collection_ids === '[]');

  return {
    prepare: vi.fn((sql: string) => ({
      bind: (id: string) => ({
        first: async () => groups.find((group) => group.id === id && isRuleTarget(group)) ?? null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({
        results: sql.includes('enabled = 1') ? groups.filter(isRuleTarget) : groups,
      }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}
