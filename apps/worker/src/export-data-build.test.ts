import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExportData } from './export-data';
import { syncAutoNodeGroups } from './services/auto-node-groups';
import { ensureDefaultRemoteRuleSets } from './services/default-rule-sets';
import { getAppSettings } from './services/app-settings';
import { syncRoutingPolicyGroups } from './services/routing-policy-groups';

vi.mock('./services/auto-node-groups', () => ({
  syncAutoNodeGroups: vi.fn(async () => undefined),
}));

vi.mock('./services/default-rule-sets', () => ({
  ensureDefaultRemoteRuleSets: vi.fn(async () => undefined),
}));

vi.mock('./services/routing-policy-groups', async (importActual) => {
  const actual = await importActual<typeof import('./services/routing-policy-groups')>();
  return {
    ...actual,
    syncRoutingPolicyGroups: vi.fn(async () => undefined),
  };
});

vi.mock('./services/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    exportNodeNamingMode: 'source_region_sequence',
  })),
}));

describe('buildExportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs auto node groups and routing policy groups before collecting export rows', async () => {
    const db = createEmptyDb();

    await buildExportData(db);

    expect(syncAutoNodeGroups).toHaveBeenCalledOnce();
    expect(syncRoutingPolicyGroups).toHaveBeenCalledOnce();
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce();
    expect(getAppSettings).toHaveBeenCalledOnce();
  });
});

function createEmptyDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true }),
        raw: async () => [],
      })),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}
