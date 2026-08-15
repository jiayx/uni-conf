import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';
import {
  ensureWorkspaceInitialized,
  ensureZeroSetupDefaults,
  WORKSPACE_DEFAULTS_VERSION,
} from './zero-setup';

vi.mock('./auto-node-groups', () => ({
  syncAutoNodeGroups: vi.fn(async () => undefined),
}));

vi.mock('./default-export-config', () => ({
  ensureDefaultExportConfig: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}));

vi.mock('./default-rule-sets', () => ({
  ensureDefaultRemoteRuleSets: vi.fn(async () => undefined),
}));
vi.mock('./app-settings', () => ({
  getAppSettings: vi.fn(async () => ({ unmatchedTrafficPolicy: 'proxy' })),
}));

vi.mock('./routing-policy-groups', () => ({
  syncRoutingPolicyGroups: vi.fn(async () => undefined),
}));

describe('zero setup defaults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensures export config, auto groups, routing policy groups, and remote rule sets together', async () => {
    const db = createDb();
    const config = await ensureZeroSetupDefaults(db, '2026-01-01T00:00:00.000Z', 'default');

    expect(config).toMatchObject({ id: 'default-mihomo', token: 'default-token', format: 'mihomo' });
    expect(ensureDefaultExportConfig).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z', 'default');
    expect(syncAutoNodeGroups).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z', 'default');
    expect(syncRoutingPolicyGroups).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z', 'default');
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z', 'proxy', undefined, 'default');
    expect(vi.mocked(syncRoutingPolicyGroups).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensureDefaultRemoteRuleSets).mock.invocationCallOrder[0] ?? 0
    );
  });

  it('skips the full reconciliation when the workspace defaults version is current', async () => {
    const db = createDb();
    const kv = createKv(String(WORKSPACE_DEFAULTS_VERSION));

    await ensureWorkspaceInitialized(db, kv, '2026-01-01T00:00:00.000Z', 'default');

    expect(ensureDefaultExportConfig).not.toHaveBeenCalled();
    expect(syncAutoNodeGroups).not.toHaveBeenCalled();
    expect(syncRoutingPolicyGroups).not.toHaveBeenCalled();
    expect(ensureDefaultRemoteRuleSets).not.toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith('workspace-defaults:default');
    expect(kv.put).not.toHaveBeenCalled();
    expect(db.prepare).toHaveBeenCalledOnce();
  });

  it('reinitializes when D1 was rebuilt but the KV version marker survived', async () => {
    const db = createDb(false);
    const kv = createKv(String(WORKSPACE_DEFAULTS_VERSION));

    await ensureWorkspaceInitialized(db, kv, '2026-01-01T00:00:00.000Z', 'default');

    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce();
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce();
    expect(syncRoutingPolicyGroups).toHaveBeenCalledOnce();
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce();
    expect(kv.put).toHaveBeenCalledWith('workspace-defaults:default', String(WORKSPACE_DEFAULTS_VERSION));
  });

  it('reconciles once and records the version when the workspace is not initialized', async () => {
    const db = createDb();
    const kv = createKv(null);

    await ensureWorkspaceInitialized(db, kv, '2026-01-01T00:00:00.000Z', 'friends');

    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce();
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce();
    expect(syncRoutingPolicyGroups).toHaveBeenCalledOnce();
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce();
    expect(kv.put).toHaveBeenCalledWith(
      'workspace-defaults:friends',
      String(WORKSPACE_DEFAULTS_VERSION),
    );
  });
});

function createDb(initialized = true): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => initialized ? { initialized: 1 } : null),
      })),
    })),
  } as unknown as D1Database;
}

function createKv(value: string | null): KVNamespace {
  return {
    get: vi.fn(async () => value),
    put: vi.fn(async () => undefined),
  } as unknown as KVNamespace;
}
