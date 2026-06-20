import { describe, expect, it } from 'vitest';
import {
  applyRoutingPolicyGroupLinks,
  resolveOutletGroupIds,
  resolveRoutingGroupIds,
} from './routing-policy-groups';

const groupRows = [
  {
    id: 'builtin-proxy',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-ai',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-direct',
    type: 'direct',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'us-auto',
    type: 'url-test',
    collection_ids: '["collection-us"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'hk-auto',
    type: 'fallback',
    collection_ids: '["collection-hk"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'disabled-exit',
    type: 'url-test',
    collection_ids: '["collection-disabled"]',
    group_ids: '[]',
    enabled: 0,
    is_builtin: 0,
  },
];

describe('routing policy group sync', () => {
  it('resolves enabled node-backed groups as outlet groups', () => {
    expect(resolveOutletGroupIds(groupRows)).toEqual(['us-auto', 'hk-auto']);
  });

  it('resolves builtin non-node select groups as routing policy groups', () => {
    expect(resolveRoutingGroupIds(groupRows)).toEqual(['builtin-proxy', 'builtin-ai']);
  });

  it('links every routing policy group to all outlet groups for preview/export', () => {
    const rows = applyRoutingPolicyGroupLinks(groupRows);

    expect(rows.find((row) => row.id === 'builtin-proxy')?.group_ids).toBe('["us-auto","hk-auto"]');
    expect(rows.find((row) => row.id === 'builtin-ai')?.group_ids).toBe('["us-auto","hk-auto"]');
    expect(rows.find((row) => row.id === 'builtin-direct')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'us-auto')?.group_ids).toBe('[]');
  });
});
