import { describe, expect, it, vi } from 'vitest';
import { isEnabledTargetGroup, listEnabledTargetGroupIds } from './group-targets';

describe('group target helpers', () => {
  it('recognizes only enabled groups as valid rule targets', async () => {
    const db = createMockDb([
      { id: 'builtin-proxy', enabled: 1 },
      { id: 'builtin-crypto', enabled: 0 },
    ]);

    await expect(isEnabledTargetGroup(db, 'builtin-proxy')).resolves.toBe(true);
    await expect(isEnabledTargetGroup(db, 'builtin-crypto')).resolves.toBe(false);
    await expect(isEnabledTargetGroup(db, 'missing')).resolves.toBe(false);
  });

  it('lists enabled target group ids', async () => {
    const db = createMockDb([
      { id: 'builtin-proxy', enabled: 1 },
      { id: 'builtin-direct', enabled: 1 },
      { id: 'builtin-crypto', enabled: 0 },
    ]);

    await expect(listEnabledTargetGroupIds(db)).resolves.toEqual(new Set(['builtin-proxy', 'builtin-direct']));
  });
});

function createMockDb(groups: Array<{ id: string; enabled: number }>): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (id: string) => ({
        first: async () => groups.find((group) => group.id === id && group.enabled === 1) ?? null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({
        results: sql.includes('enabled = 1') ? groups.filter((group) => group.enabled === 1) : groups,
      }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}
