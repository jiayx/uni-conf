import { describe, expect, it } from 'vitest';
import {
  applyRoutingPolicyGroupLinks,
  resolveActiveTemplateGroupNames,
  resolveManagedTemplateGroupNames,
  resolveOutletGroupIds,
  resolveRoutingGroupIds,
} from './routing-policy-groups';
import { ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared';

const groupRows = [
  {
    id: 'builtin-proxy',
    name: 'PROXY',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-ai',
    name: 'AI',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-streaming',
    name: 'Streaming',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-github',
    name: 'GitHub',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-telegram',
    name: 'Telegram',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-final',
    name: '漏网之鱼',
    type: 'select',
    collection_ids: '[]',
    group_ids: '["builtin-proxy"]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-direct',
    name: 'DIRECT',
    type: 'direct',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-reject',
    name: 'REJECT',
    type: 'reject',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-all-nodes',
    name: '全部节点',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-node-select',
    name: '节点选择',
    type: 'select',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-auto-select',
    name: '自动选择',
    type: 'url-test',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'builtin-fallback-select',
    name: '故障切换',
    type: 'fallback',
    collection_ids: '[]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 1,
  },
  {
    id: 'us-auto',
    name: '🇺🇸 US Auto',
    type: 'url-test',
    collection_ids: '["collection-us"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'hk-auto',
    name: '🇭🇰 HK Auto',
    type: 'fallback',
    collection_ids: '["collection-hk"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'jp-auto',
    name: '🇯🇵 JP Auto',
    type: 'url-test',
    collection_ids: '["collection-jp"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'sg-auto',
    name: '🇸🇬 SG Auto',
    type: 'url-test',
    collection_ids: '["collection-sg"]',
    group_ids: '[]',
    enabled: 1,
    is_builtin: 0,
  },
  {
    id: 'disabled-exit',
    name: 'Disabled Auto',
    type: 'url-test',
    collection_ids: '["collection-disabled"]',
    group_ids: '[]',
    enabled: 0,
    is_builtin: 0,
  },
];

describe('routing policy group sync', () => {
  it('keeps foundation policy and full-node outlet groups enabled for the empty template', () => {
    const emptyTemplate = ROUTING_POLICY_TEMPLATES.find((template) => template.id === 'empty');

    expect(emptyTemplate).toBeDefined();
    expect([...resolveActiveTemplateGroupNames(emptyTemplate!)]).toEqual([
      'PROXY',
      'DIRECT',
      'REJECT',
      '全部节点',
      '节点选择',
      '自动选择',
      '故障切换',
    ]);
  });

  it('manages every generated foundation and business group through templates', () => {
    expect([...resolveManagedTemplateGroupNames()]).toEqual([
      'PROXY',
      'DIRECT',
      'REJECT',
      '全部节点',
      '节点选择',
      '自动选择',
      '故障切换',
      'AI',
      'STREAMING',
      'TELEGRAM',
      'SOCIAL',
      'GITHUB',
      'APPLE',
      'MICROSOFT',
      '漏网之鱼',
      'CRYPTO',
      'GAMING',
      'DEVELOPER',
    ]);
  });

  it('resolves default and node-backed groups as outlet groups', () => {
    expect(resolveOutletGroupIds(groupRows)).toEqual([
      'builtin-proxy',
      'builtin-direct',
      'builtin-reject',
      'builtin-all-nodes',
      'builtin-node-select',
      'builtin-auto-select',
      'builtin-fallback-select',
      'us-auto',
      'hk-auto',
      'jp-auto',
      'sg-auto',
    ]);
  });

  it('resolves builtin non-node select groups as routing policy groups', () => {
    expect(resolveRoutingGroupIds(groupRows)).toEqual([
      'builtin-proxy',
      'builtin-ai',
      'builtin-streaming',
      'builtin-github',
      'builtin-telegram',
      'builtin-final',
    ]);
  });

  it('links every routing policy group to all outlet groups for preview/export', () => {
    const rows = applyRoutingPolicyGroupLinks(groupRows);

    expect(rows.find((row) => row.id === 'builtin-proxy')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-ai')?.group_ids).toBe(
      '["us-auto","jp-auto","sg-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","hk-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-streaming')?.group_ids).toBe(
      '["hk-auto","jp-auto","sg-auto","us-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject"]'
    );
    expect(rows.find((row) => row.id === 'builtin-github')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-telegram')?.group_ids).toBe(
      '["sg-auto","hk-auto","jp-auto","us-auto","builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject"]'
    );
    expect(rows.find((row) => row.id === 'builtin-final')?.group_ids).toBe(
      '["builtin-auto-select","builtin-node-select","builtin-fallback-select","builtin-all-nodes","builtin-proxy","builtin-direct","builtin-reject","us-auto","hk-auto","jp-auto","sg-auto"]'
    );
    expect(rows.find((row) => row.id === 'builtin-direct')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'builtin-all-nodes')?.group_ids).toBe('[]');
    expect(rows.find((row) => row.id === 'us-auto')?.group_ids).toBe('[]');
  });
});
