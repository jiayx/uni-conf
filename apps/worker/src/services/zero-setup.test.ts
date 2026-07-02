import { describe, expect, it, vi } from 'vitest';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';
import { ensureZeroSetupDefaults } from './zero-setup';

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

vi.mock('./routing-policy-groups', () => ({
  syncRoutingPolicyGroups: vi.fn(async () => undefined),
}));

describe('zero setup defaults', () => {
  it('ensures export config, auto groups, routing policy groups, and remote rule sets together', async () => {
    const db = {} as D1Database;
    const config = await ensureZeroSetupDefaults(db, '2026-01-01T00:00:00.000Z');

    expect(config).toMatchObject({ id: 'default-mihomo', token: 'default-token', format: 'mihomo' });
    expect(ensureDefaultExportConfig).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z');
    expect(syncAutoNodeGroups).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z');
    expect(syncRoutingPolicyGroups).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z');
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z');
    expect(vi.mocked(syncRoutingPolicyGroups).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensureDefaultRemoteRuleSets).mock.invocationCallOrder[0] ?? 0
    );
  });
});
