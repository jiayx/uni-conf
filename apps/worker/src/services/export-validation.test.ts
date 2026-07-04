import { describe, expect, it } from 'vitest';
import type { ExportData } from '../export-data';
import {
  findBlockingExportWarning,
  findBlockingNodeExportWarning,
  findEmptyNodeExportWarning,
  resolveExportWarnings,
  validateExportData,
  validateRemoteRuleSetReachability,
} from './export-validation';

const createdAt = '2026-01-01T00:00:00.000Z';

describe('export validation', () => {
  it('warns about empty node exports', () => {
    const warnings = validateExportData(makeExportData({ nodes: [], rules: [] }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'unsupported', message: expect.stringContaining('没有可导出的节点') }),
    ]));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('缺少 MATCH'),
    }));
  });

  it('exposes empty node exports as a blocking download condition', () => {
    expect(findEmptyNodeExportWarning(makeExportData({ nodes: [] }), 'mihomo')).toEqual(expect.objectContaining({
      client: 'mihomo',
      level: 'unsupported',
      message: expect.stringContaining('没有可导出的节点'),
    }));
    expect(findEmptyNodeExportWarning(makeExportData(), 'mihomo')).toBeNull();
  });

  it('blocks downloads when no node protocol can be rendered for the target format', () => {
    expect(findBlockingNodeExportWarning(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
    }), 'mihomo')).toEqual(expect.objectContaining({
      client: 'mihomo',
      level: 'unsupported',
      message: expect.stringContaining('没有可导出到 mihomo 的节点'),
    }));

    expect(findBlockingNodeExportWarning(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
    }), 'singbox')).toBeNull();
  });

  it('blocks downloads for structural readiness errors', () => {
    expect(findBlockingExportWarning(makeExportData({
      groups: [makeGroup('proxy', 'PROXY', ['missing-child'])],
    }), 'mihomo')).toEqual(expect.objectContaining({
      groupId: 'proxy',
      level: 'unsupported',
    }));

    expect(findBlockingExportWarning(makeExportData({
      remoteSets: [makeRemoteSet('bad-url', 'proxy', { url: './local-rule.yaml' })],
    }), 'mihomo')).toEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('不是可下载的 http(s) 地址'),
    }));
  });

  it('does not block downloads only because a source has a refresh warning', () => {
    expect(findBlockingExportWarning(makeExportData({
      sources: [makeSource('source-1', 'Airport A', { lastRefreshError: 'HTTP 401' })],
    }), 'mihomo')).toBeNull();
  });

  it('keeps no-supported-node readiness warnings when compatibility warnings are disabled', () => {
    const warnings = resolveExportWarnings(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
    }), 'mihomo', {
      showCompatibilityWarnings: false,
      dnsMode: 'smart',
    });

    expect(warnings).toContainEqual(expect.objectContaining({
      client: 'mihomo',
      level: 'unsupported',
      message: expect.stringContaining('没有可导出到 mihomo 的节点'),
    }));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-wg',
      message: expect.stringContaining('wireguard'),
    }));
  });

  it('does not warn when MATCH is omitted because exporters add the fallback', () => {
    const warnings = validateExportData(makeExportData({ rules: [] }), 'mihomo');

    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('缺少 MATCH'),
    }));
  });

  it('warns about duplicate node names', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-1', 'HK 01'), makeNode('node-2', 'HK 01')],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'partial',
      message: expect.stringContaining('HK 01'),
    }));
  });

  it('warns when an enabled URL source has a refresh error', () => {
    const warnings = validateExportData(makeExportData({
      sources: [makeSource('source-1', 'Airport A', { lastRefreshError: 'HTTP 401' })],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('Airport A'),
      messageEn: expect.stringContaining('HTTP 401'),
    }));
  });

  it('warns when an enabled URL source has never refreshed successfully', () => {
    const warnings = validateExportData(makeExportData({
      sources: [makeSource('source-1', 'Airport A', { nodeCount: 0, lastUpdated: undefined })],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'partial',
      message: expect.stringContaining('尚未成功刷新'),
    }));
  });

  it('warns about missing group references from rules, remote sets, and nested groups', () => {
    const warnings = validateExportData(makeExportData({
      groups: [makeGroup('proxy', 'PROXY', ['missing-child'])],
      rules: [makeRule('rule-1', 'missing-rule-target', 'DOMAIN-SUFFIX', 'example.com')],
      remoteSets: [makeRemoteSet('remote-1', 'missing-remote-target')],
    }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: 'proxy', level: 'unsupported' }),
      expect.objectContaining({ ruleId: 'rule-1', level: 'unsupported' }),
      expect.objectContaining({ message: expect.stringContaining('远程规则集') }),
    ]));
  });

  it('warns when a policy group node collection has no exportable nodes', () => {
    const warnings = validateExportData(makeExportData({
      groups: [makeGroup('empty-auto', 'US Auto', [], { collectionIds: ['collection-us'] })],
      collectionNodeNames: {},
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      groupId: 'empty-auto',
      level: 'partial',
      message: expect.stringContaining('没有可导出的节点'),
    }));
  });

  it('warns when a policy group references node names missing from the final proxies', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-1', 'HK 01')],
      groups: [makeGroup('hk-auto', 'HK Auto', [], { collectionIds: ['collection-hk'] })],
      collectionNodeNames: { 'collection-hk': ['HK 01', 'HK Missing'] },
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      groupId: 'hk-auto',
      level: 'unsupported',
      message: expect.stringContaining('HK Missing'),
    }));
  });

  it('warns when a node protocol is not supported by the target exporter', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [
        makeNode('node-ss', 'HK 01'),
        makeNode('node-wg', 'WG 01', { protocol: 'wireguard' }),
      ],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['HK 01', 'WG 01'] },
    }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'node-wg',
        level: 'partial',
        message: expect.stringContaining('wireguard'),
      }),
      expect.objectContaining({
        groupId: 'auto',
        level: 'unsupported',
        message: expect.stringContaining('WG 01'),
      }),
    ]));
  });

  it('does not warn about WireGuard for sing-box exports', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['WG 01'] },
    }), 'singbox');

    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-wg',
    }));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      groupId: 'auto',
      message: expect.stringContaining('WG 01'),
    }));
  });

  it('warns when MATCH is not the final rule', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('match', 'proxy', 'MATCH', '', 0),
        makeRule('late', 'proxy', 'DOMAIN-SUFFIX', 'example.com', 1),
      ],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: 'match',
      level: 'partial',
      message: expect.stringContaining('MATCH 规则不是最后一条'),
    }));
  });

  it('warns when a rule type is unsupported by the export format', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('process', 'proxy', 'PROCESS-NAME', 'Example.app', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'shadowrocket');

    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: 'process',
      level: 'unsupported',
      message: expect.stringContaining('PROCESS-NAME 不兼容 shadowrocket'),
    }));
  });

  it('warns when a rule type is only partially supported by the export format', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('regex', 'proxy', 'DOMAIN-REGEX', '^api\\.', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'surge');

    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: 'regex',
      level: 'partial',
      message: expect.stringContaining('DOMAIN-REGEX 在 surge 中只能部分兼容'),
    }));
  });

  it('warns when script rules cannot be serialized by the target export format', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('script', 'proxy', 'SCRIPT', 'script-path', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'quantumultx');

    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: 'script',
      level: 'unsupported',
      message: expect.stringContaining('SCRIPT 不兼容 quantumultx'),
    }));
  });

  it('does not warn about rule type compatibility for node-only subscriptions', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('process', 'proxy', 'PROCESS-NAME', 'Example.app', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'nodes_raw');

    expect(warnings).not.toContainEqual(expect.objectContaining({
      ruleId: 'process',
      message: expect.stringContaining('PROCESS-NAME'),
    }));
  });

  it('ignores policy group, rule, remote rule set, and DNS warnings for node-only subscriptions', () => {
    const warnings = validateExportData(makeExportData({
      groups: [makeGroup('proxy', 'PROXY', ['missing-child'])],
      rules: [makeRule('rule-1', 'missing-rule-target', 'PROCESS-NAME', 'Example.app')],
      remoteSets: [makeRemoteSet('bad-url', 'missing-remote-target', { url: './local-rule.yaml', format: 'singbox' })],
    }), 'nodes_raw', { dnsMode: 'fake-ip' });

    expect(warnings).not.toContainEqual(expect.objectContaining({ groupId: 'proxy' }));
    expect(warnings).not.toContainEqual(expect.objectContaining({ ruleId: 'rule-1' }));
    expect(warnings).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('远程规则集') }));
    expect(warnings).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('高级 fake-ip') }));
  });

  it('accepts WireGuard nodes for node-only subscriptions', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
    }), 'nodes_raw');

    expect(findBlockingNodeExportWarning(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
    }), 'nodes_raw')).toBeNull();
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-wg',
      message: expect.stringContaining('wireguard'),
    }));
  });

  it('accepts ShadowsocksR nodes for node-only subscriptions', () => {
    const node = makeNode('node-ssr', 'HK SSR', {
      protocol: 'ssr',
      parsedConfig: {
        protocol: 'ssr',
        server: 'node-ssr.example.com',
        port: 443,
        password: 'secret',
        extra: {
          method: 'aes-256-cfb',
          protocol: 'auth_sha1_v4',
          obfs: 'tls1.2_ticket_auth',
        },
      },
    });
    const warnings = validateExportData(makeExportData({ nodes: [node] }), 'nodes_raw');

    expect(findBlockingNodeExportWarning(makeExportData({ nodes: [node] }), 'nodes_raw')).toBeNull();
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-ssr',
      message: expect.stringContaining('订阅 URI'),
    }));
  });

  it('accepts Hysteria nodes for node-only subscriptions', () => {
    const node = makeNode('node-hysteria', 'SG Hysteria', {
      protocol: 'hysteria',
      parsedConfig: {
        protocol: 'hysteria',
        server: 'node-hysteria.example.com',
        port: 443,
        password: 'auth-secret',
        extra: {},
      },
    });
    const warnings = validateExportData(makeExportData({ nodes: [node] }), 'nodes_raw');

    expect(findBlockingNodeExportWarning(makeExportData({ nodes: [node] }), 'nodes_raw')).toBeNull();
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-hysteria',
      message: expect.stringContaining('订阅 URI'),
    }));
  });

  it('accepts ShadowsocksR nodes for full config exporters that can render it', () => {
    const node = makeNode('node-ssr', 'HK SSR', {
      protocol: 'ssr',
      parsedConfig: {
        protocol: 'ssr',
        server: 'node-ssr.example.com',
        port: 443,
        password: 'secret',
        extra: {
          method: 'aes-256-cfb',
          protocol: 'auth_sha1_v4',
          obfs: 'tls1.2_ticket_auth',
        },
      },
    });
    const warnings = validateExportData(makeExportData({ nodes: [node] }), 'mihomo');
    const singboxWarnings = validateExportData(makeExportData({ nodes: [node] }), 'singbox');

    expect(findEmptyNodeExportWarning(makeExportData({ nodes: [node] }), 'mihomo')).toBeNull();
    expect(findEmptyNodeExportWarning(makeExportData({ nodes: [node] }), 'singbox')).toBeNull();
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-ssr',
      message: expect.stringContaining('ssr'),
    }));
    expect(singboxWarnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-ssr',
      message: expect.stringContaining('ssr'),
    }));
  });

  it('blocks node-only downloads when no node row can be serialized as a subscription URI', () => {
    const node = makeNode('node-ss', 'Broken SS', { protocol: 'ss' });
    const data = makeExportData({
      nodes: [node],
      nodeRows: [makeNodeRow(node, { server: '', port: 0 })],
    });

    expect(findBlockingNodeExportWarning(data, 'nodes_raw')).toEqual(expect.objectContaining({
      client: 'nodes_raw',
      level: 'unsupported',
      message: expect.stringContaining('没有可导出到 nodes_raw 的节点'),
    }));

    expect(validateExportData(data, 'nodes_raw')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        client: 'nodes_raw',
        level: 'unsupported',
        message: expect.stringContaining('没有可导出到 nodes_raw 的节点'),
      }),
      expect.objectContaining({
        nodeId: 'node-ss',
        level: 'partial',
        message: expect.stringContaining('订阅 URI'),
      }),
    ]));
  });

  it('warns when a remote rule set is incompatible with the export format', () => {
    const warnings = validateExportData(makeExportData({
      remoteSets: [makeRemoteSet('singbox-remote', 'proxy', { format: 'singbox' })],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'partial',
      message: expect.stringContaining('不兼容 mihomo'),
    }));
  });

  it('does not warn when a dynamic Quixotic preset resolves to a compatible export format', () => {
    const warnings = validateExportData(makeExportData({
      remoteSets: [makeRemoteSet('quixotic-ai', 'proxy', {
        presetSource: 'quixotic',
        presetId: 'ai',
        format: 'mihomo',
      })],
    }), 'singbox');

    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('不兼容 singbox'),
    }));
  });

  it('warns when a remote rule set URL is not downloadable', () => {
    const warnings = validateExportData(makeExportData({
      remoteSets: [makeRemoteSet('bad-url', 'proxy', { url: './local-rule.yaml' })],
    }), 'mihomo');

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('不是可下载的 http(s) 地址'),
    }));
  });

  it('checks whether compatible remote rule sets can be downloaded', async () => {
    const fetcher = async () => new Response('', { status: 404 });
    const warnings = await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy', { name: 'Ads' })],
    }), 'mihomo', { fetcher });

    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('Ads'),
      messageEn: expect.stringContaining('cannot be downloaded'),
    }));
  });

  it('falls back to ranged GET when a remote rule set host does not support HEAD', async () => {
    const calls: Array<{ url: string; method?: string; range?: string | null }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method,
        range: init?.headers instanceof Headers
          ? init.headers.get('Range')
          : (init?.headers as Record<string, string> | undefined)?.Range ?? null,
      });
      return new Response('', { status: init?.method === 'HEAD' ? 405 : 206 });
    };
    const warnings = await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy')],
    }), 'mihomo', { fetcher });

    expect(warnings).toEqual([]);
    expect(calls).toEqual([
      { url: 'https://example.com/remote.list', method: 'HEAD', range: null },
      { url: 'https://example.com/remote.list', method: 'GET', range: 'bytes=0-0' },
    ]);
  });

  it('skips remote rule set reachability checks for incompatible or node-only exports', async () => {
    const fetcher = async () => {
      throw new Error('should not fetch');
    };

    await expect(validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy', { format: 'singbox' })],
    }), 'mihomo', { fetcher })).resolves.toEqual([]);
    await expect(validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy')],
    }), 'nodes_raw', { fetcher })).resolves.toEqual([]);
  });

  it('caches a reachable rule set result in KV and skips re-fetching on the next call', async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return new Response('', { status: 200 });
    };
    const kv = createMockKv();

    await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy')],
    }), 'mihomo', { fetcher, kv });
    expect(fetchCount).toBe(1);

    const warnings = await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy')],
    }), 'mihomo', { fetcher, kv });

    expect(fetchCount).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('caches an unreachable rule set result in KV and keeps warning without re-fetching', async () => {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return new Response('', { status: 404 });
    };
    const kv = createMockKv();

    await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy', { name: 'Ads' })],
    }), 'mihomo', { fetcher, kv });
    expect(fetchCount).toBe(1); // 404 short-circuits before the ranged GET fallback

    const warnings = await validateRemoteRuleSetReachability(makeExportData({
      remoteSets: [makeRemoteSet('remote-1', 'proxy', { name: 'Ads' })],
    }), 'mihomo', { fetcher, kv });

    expect(fetchCount).toBe(1);
    expect(warnings).toContainEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('Ads'),
    }));
  });

  it('warns when the export format cannot include managed DNS settings', () => {
    const warnings = validateExportData(makeExportData(), 'loon', { dnsMode: 'smart' });

    expect(warnings).toContainEqual(expect.objectContaining({
      client: 'loon',
      level: 'partial',
      message: expect.stringContaining('智能防污染'),
    }));
  });

  it('does not warn about DNS for formats with managed DNS export support', () => {
    expect(validateExportData(makeExportData(), 'mihomo', { dnsMode: 'fake-ip' })).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('高级 fake-ip'),
    }));
    expect(validateExportData(makeExportData(), 'singbox', { dnsMode: 'fake-ip' })).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('高级 fake-ip'),
    }));
    expect(validateExportData(makeExportData(), 'stash', { dnsMode: 'fake-ip' })).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('高级 fake-ip'),
    }));
  });

  it('keeps readiness warnings when compatibility warnings are disabled', () => {
    const warnings = resolveExportWarnings(makeExportData({
      nodes: [],
      rules: [
        makeRule('process', 'proxy', 'PROCESS-NAME', 'Example.app', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'shadowrocket', {
      showCompatibilityWarnings: false,
      dnsMode: 'fake-ip',
    });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('没有可导出的节点') }),
    ]));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('PROCESS-NAME 不兼容 shadowrocket'),
    }));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('高级 fake-ip'),
    }));
  });
});

function makeExportData(patch: Partial<ExportData> = {}): ExportData {
  const groups = patch.groups ?? [makeGroup('proxy', 'PROXY')];
  const nodes = patch.nodes ?? [makeNode('node-1', 'HK 01')];
  return {
    nodeRows: nodes.map((node) => makeNodeRow(node)),
    groupRows: [],
    ruleRows: [],
    remoteSetRows: [],
    sourceRows: [],
    sources: patch.sources ?? [],
    nodes,
    groups,
    rules: patch.rules ?? [makeRule('match', groups[0]!.id, 'MATCH', '')],
    remoteSets: patch.remoteSets ?? [],
    collectionNodeNames: {},
    ...patch,
  };
}

function makeNodeRow(
  node: ExportData['nodes'][number],
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: node.id,
    source_id: node.sourceId,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    enabled: node.enabled ? 1 : 0,
    raw_config: JSON.stringify(node.rawConfig),
    parsed_config: JSON.stringify(node.parsedConfig),
    ...patch,
  };
}

function makeSource(
  id: string,
  name: string,
  patch: Partial<ExportData['sources'][number]> = {}
): ExportData['sources'][number] {
  return {
    id,
    name,
    type: 'url',
    url: `https://${id}.example.com/sub`,
    format: 'auto',
    enabled: true,
    nodeCount: 1,
    lastUpdated: createdAt,
    updateInterval: 1440,
    tags: [],
    groups: [],
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function makeNode(
  id: string,
  name: string,
  patch: Partial<ExportData['nodes'][number]> = {}
): ExportData['nodes'][number] {
  const protocol = patch.protocol ?? 'trojan';
  return {
    id,
    sourceId: 'source-1',
    name,
    protocol,
    server: `${id}.example.com`,
    port: 443,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol, server: `${id}.example.com`, port: 443, extra: {} },
    isManual: false,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function makeGroup(
  id: string,
  name: string,
  groupIds: string[] = [],
  patch: Partial<ExportData['groups'][number]> = {}
): ExportData['groups'][number] {
  return {
    id,
    name,
    type: 'select',
    collectionIds: [],
    groupIds,
    builtins: ['DIRECT'],
    enabled: true,
    order: 0,
    isBuiltin: false,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function makeRule(
  id: string,
  targetGroupId: string,
  type: ExportData['rules'][number]['type'],
  payload: string,
  order = 999
): ExportData['rules'][number] {
  return {
    id,
    type,
    payload,
    targetGroupId,
    enabled: true,
    order,
    compatibility: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function makeRemoteSet(
  id: string,
  targetGroupId: string,
  patch: Partial<ExportData['remoteSets'][number]> = {}
): ExportData['remoteSets'][number] {
  return {
    id,
    name: 'Remote',
    url: 'https://example.com/remote.list',
    format: 'mihomo',
    behavior: 'classical',
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function createMockKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}
