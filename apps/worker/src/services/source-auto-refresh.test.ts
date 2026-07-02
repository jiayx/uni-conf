import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshDueSources, resolveDueSources } from './source-auto-refresh';

vi.mock('./app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    enableAutoRefresh: true,
    autoRefreshInterval: 60,
  })),
}));

vi.mock('../routes/sources', () => ({
  refreshSourceById: vi.fn(async (_db: D1Database, id: string) => {
    if (id === 'source-fail') throw new Error('network failed');
    return { sourceId: id, success: true, nodeCount: 1 };
  }),
  recordSourceRefreshError: vi.fn(async () => undefined),
}));

vi.mock('./zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => undefined),
}));

import { recordSourceRefreshError, refreshSourceById } from '../routes/sources';
import { ensureZeroSetupDefaults } from './zero-setup';

const nowMs = Date.parse('2026-06-21T12:00:00.000Z');

describe('source auto refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes never-updated sources', () => {
    expect(resolveDueSources([
      { id: 'source-1', last_updated: null, update_interval: 0 },
    ], 60, nowMs).map(source => source.id)).toEqual(['source-1']);
  });

  it('uses per-source update interval before global interval', () => {
    const sources = [
      { id: 'global-not-due', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 0 },
      { id: 'source-due', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 20 },
      { id: 'source-not-due', last_updated: '2026-06-21T11:50:00.000Z', update_interval: 20 },
    ];

    expect(resolveDueSources(sources, 60, nowMs).map(source => source.id)).toEqual(['source-due']);
  });

  it('defaults the global interval to twenty four hours', () => {
    const sources = [
      { id: 'not-due', last_updated: '2026-06-21T11:00:00.000Z', update_interval: 0 },
      { id: 'due', last_updated: '2026-06-20T11:59:00.000Z', update_interval: 0 },
    ];

    expect(resolveDueSources(sources, 0, nowMs).map(source => source.id)).toEqual(['due']);
  });

  it('treats invalid timestamps as due', () => {
    expect(resolveDueSources([
      { id: 'source-1', last_updated: 'not-a-date', update_interval: 60 },
    ], 60, nowMs).map(source => source.id)).toEqual(['source-1']);
  });

  it('enforces a minimum five minute interval', () => {
    const sources = [
      { id: 'too-soon', last_updated: '2026-06-21T11:57:00.000Z', update_interval: 1 },
      { id: 'due', last_updated: '2026-06-21T11:54:00.000Z', update_interval: 1 },
    ];

    expect(resolveDueSources(sources, 1, nowMs).map(source => source.id)).toEqual(['due']);
  });

  it('continues refreshing due sources and records per-source failures', async () => {
    const db = createMockDb([
      { id: 'source-ok', last_updated: null, update_interval: 0 },
      { id: 'source-fail', last_updated: null, update_interval: 0 },
      { id: 'source-later', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 60 },
    ]);

    const result = await refreshDueSources(db, nowMs);

    expect(refreshSourceById).toHaveBeenCalledTimes(2);
    expect(ensureZeroSetupDefaults).toHaveBeenCalledTimes(2);
    expect(ensureZeroSetupDefaults).toHaveBeenNthCalledWith(1, db, '2026-06-21T12:00:00.000Z');
    expect(ensureZeroSetupDefaults).toHaveBeenNthCalledWith(2, db, '2026-06-21T12:00:00.000Z');
    expect(refreshSourceById).toHaveBeenNthCalledWith(1, db, 'source-ok');
    expect(refreshSourceById).toHaveBeenNthCalledWith(2, db, 'source-fail');
    expect(recordSourceRefreshError).toHaveBeenCalledWith(db, 'source-fail', 'network failed');
    expect(result).toMatchObject({
      checkedCount: 3,
      refreshedCount: 1,
      failedCount: 1,
      skipped: false,
      refreshedSourceIds: ['source-ok'],
      errors: [{ sourceId: 'source-fail', error: 'network failed' }],
    });
  });

  it('skips zero-setup initialization when auto refresh is disabled', async () => {
    const { getAppSettings } = await import('./app-settings');
    vi.mocked(getAppSettings).mockResolvedValueOnce({
      enableAutoRefresh: false,
      autoRefreshInterval: 60,
    } as Awaited<ReturnType<typeof getAppSettings>>);
    const db = createMockDb([{ id: 'source-ok', last_updated: null, update_interval: 0 }]);

    const result = await refreshDueSources(db, nowMs);

    expect(result.skipped).toBe(true);
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled();
    expect(refreshSourceById).not.toHaveBeenCalled();
  });

  it('does not run a second zero-setup sync when no source is due', async () => {
    const db = createMockDb([{ id: 'source-ok', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 60 }]);

    const result = await refreshDueSources(db, nowMs);

    expect(result.refreshedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce();
    expect(refreshSourceById).not.toHaveBeenCalled();
  });
});

function createMockDb(rows: Array<{ id: string; last_updated: string | null; update_interval: number | null }>): D1Database {
  return {
    prepare: vi.fn(() => ({
      all: async () => ({ results: rows }),
      bind: vi.fn(() => ({
        all: async () => ({ results: rows }),
        first: async () => null,
        run: async () => ({ success: true }),
        raw: async () => [],
      })),
      first: async () => null,
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}
