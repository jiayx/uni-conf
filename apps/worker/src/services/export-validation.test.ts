import { describe, expect, it } from 'vitest';
import type { ExportData } from '../export-data';
import {
  findBlockingExportWarning,
  findBlockingNodeExportWarning,
  findEmptyNodeExportWarning,
  resolveExportWarnings,
  validateExportData,
} from './export-validation';

const createdAt = '2026-01-01T00:00:00.000Z';

describe('export validation', () => {
  it('warns about empty node exports', () => {
    const warnings = validateExportData(makeExportData({ nodes: [], rules: [] }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'unsupported',
        message: expect.stringContaining('没有可导出的节点'),
        remediation: { target: 'sources' },
      }),
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
      groups: [makeGroup('proxy', 'PROXY', ['missing-child'], { isBuiltin: true })],
    }), 'mihomo')).toEqual(expect.objectContaining({
      groupId: 'proxy',
      level: 'unsupported',
      remediation: { target: 'groups' },
    }));

    expect(findBlockingExportWarning(makeExportData({
      remoteSets: [makeRemoteSet('bad-url', 'proxy', { url: './local-rule.yaml' })],
    }), 'mihomo')).toEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('不是可下载的 http(s) 地址'),
      remediation: { target: 'remote-rule-sets', id: 'bad-url' },
    }));
  });

  it('opens an editable custom group when its export structure needs repair', () => {
    expect(findBlockingExportWarning(makeExportData({
      groups: [makeGroup('custom-proxy', 'Custom Proxy', ['missing-child'])],
    }), 'mihomo')).toEqual(expect.objectContaining({
      groupId: 'custom-proxy',
      remediation: { target: 'groups', id: 'custom-proxy' },
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
      remediation: { target: 'sources', id: 'source-1' },
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
      expect.objectContaining({ groupId: 'proxy', level: 'unsupported', remediation: { target: 'groups', id: 'proxy' } }),
      expect.objectContaining({ ruleId: 'rule-1', level: 'unsupported', remediation: { target: 'rules', id: 'rule-1' } }),
      expect.objectContaining({ message: expect.stringContaining('远程规则集'), remediation: { target: 'remote-rule-sets', id: 'remote-1' } }),
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
        makeNode('manual-wg', 'Manual WG', {
          protocol: 'wireguard',
          sourceId: 'manual',
          isManual: true,
        }),
      ],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['HK 01', 'WG 01'] },
    }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'node-wg',
        level: 'partial',
        message: expect.stringContaining('wireguard'),
        remediation: { target: 'sources', id: 'source-1' },
      }),
      expect.objectContaining({
        nodeId: 'manual-wg',
        remediation: { target: 'nodes', id: 'manual-wg' },
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

  it('uses Mihomo node capabilities for Clash exports', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-vless', 'VLESS 01', { protocol: 'vless' })],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['VLESS 01'] },
    }), 'clash');

    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-vless',
    }));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      groupId: 'auto',
      message: expect.stringContaining('VLESS 01'),
    }));
  });

  it('uses native profile capabilities for Quantumult X exports', () => {
    const warnings = validateExportData(makeExportData({
      nodes: [makeNode('node-wg', 'WG 01', { protocol: 'wireguard' })],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['WG 01'] },
    }), 'quantumultx');

    expect(warnings).toContainEqual(expect.objectContaining({
      nodeId: 'node-wg',
      level: 'partial',
    }));
    expect(warnings).toContainEqual(expect.objectContaining({
      groupId: 'auto',
      message: expect.stringContaining('WG 01'),
    }));
  });

  it('reports sing-box manual-rule capability gaps instead of silently dropping behavior', () => {
    const group = makeGroup('proxy', 'PROXY');
    const sourceRule = {
      ...makeRule('source-rule', group.id, 'SRC-IP-CIDR', '10.0.0.0/8'),
      noResolve: true,
    };
    const unsupportedAsn = makeRule('asn-rule', group.id, 'IP-ASN', '13335');
    const processPath = makeRule('process-rule', group.id, 'PROCESS-PATH', '/usr/bin/curl');
    const warnings = validateExportData(makeExportData({
      groups: [group],
      rules: [sourceRule, unsupportedAsn, processPath],
    }), 'singbox');

    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: sourceRule.id,
      level: 'partial',
      messageEn: expect.stringContaining('no semantics-equivalent option'),
      remediation: { target: 'rules', id: sourceRule.id },
    }));
    expect(warnings).toContainEqual(expect.objectContaining({
      ruleId: unsupportedAsn.id,
      level: 'unsupported',
      messageEn: expect.stringContaining('not supported by singbox'),
    }));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      ruleId: processPath.id,
    }));
  });

  it('blocks invalid manual-rule payloads and links to the exact rule', () => {
    const group = makeGroup('proxy', 'PROXY');
    const invalidRule = makeRule('invalid-cidr', group.id, 'IP-CIDR', '999.1.1.1/24');
    const data = makeExportData({ groups: [group], rules: [invalidRule] });

    expect(validateExportData(data, 'mihomo')).toContainEqual(expect.objectContaining({
      ruleId: invalidRule.id,
      level: 'unsupported',
      messageEn: expect.stringContaining('invalid payload'),
      remediation: { target: 'rules', id: invalidRule.id },
    }));
    expect(findBlockingExportWarning(data, 'mihomo')).toEqual(expect.objectContaining({
      ruleId: invalidRule.id,
    }));
  });

  it('reports only lossy or unsupported value-dependent rule handling', () => {
    const group = makeGroup('proxy', 'PROXY');
    const protocolTcp = makeRule('protocol-tcp', group.id, 'PROTOCOL', 'tcp', 1);
    const protocolHttp = makeRule('protocol-http', group.id, 'PROTOCOL', 'http', 2);
    const networkIcmp = makeRule('network-icmp', group.id, 'NETWORK', 'icmp', 3);
    const portNoResolve = {
      ...makeRule('port-no-resolve', group.id, 'PORT', '443', 4),
      noResolve: true,
    };
    const data = makeExportData({
      groups: [group],
      rules: [protocolTcp, protocolHttp, networkIcmp, portNoResolve],
    });

    const mihomoWarnings = validateExportData(data, 'mihomo');
    expect(mihomoWarnings).not.toContainEqual(expect.objectContaining({
      code: 'rule-converted',
    }));

    const quantumultxWarnings = validateExportData(makeExportData({
      groups: [group],
      rules: [makeRule('domain-suffix', group.id, 'DOMAIN-SUFFIX', 'example.com')],
    }), 'quantumultx');
    expect(quantumultxWarnings).toEqual([]);
    expect(mihomoWarnings).toContainEqual(expect.objectContaining({
      code: 'rule-unsupported',
      ruleId: protocolHttp.id,
      level: 'unsupported',
      transformation: expect.objectContaining({
        action: 'skip',
        source: 'PROTOCOL,http',
      }),
    }));
    expect(mihomoWarnings).toContainEqual(expect.objectContaining({
      ruleId: networkIcmp.id,
      level: 'unsupported',
    }));
    expect(mihomoWarnings).toContainEqual(expect.objectContaining({
      code: 'rule-option-omitted',
      ruleId: portNoResolve.id,
      level: 'partial',
      messageEn: expect.stringContaining('no semantics-equivalent option'),
      transformation: expect.objectContaining({
        action: 'omit-option',
        source: 'PORT,443,no-resolve',
        target: 'DST-PORT,443',
      }),
    }));

    const singboxWarnings = validateExportData(data, 'singbox');
    expect(singboxWarnings).not.toContainEqual(expect.objectContaining({
      code: 'rule-converted',
    }));
    expect(singboxWarnings).not.toContainEqual(expect.objectContaining({
      ruleId: networkIcmp.id,
    }));
  });

  it('warns and removes group references for unsupported Loon transports', () => {
    const node = makeNode('node-grpc', 'gRPC Node', {
      protocol: 'vless',
      parsedConfig: {
        protocol: 'vless',
        server: 'node-grpc.example.com',
        port: 443,
        uuid: '00000000-0000-4000-8000-000000000001',
        network: 'grpc',
        tls: true,
        extra: {},
      },
    });
    const data = makeExportData({
      nodes: [node],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['gRPC Node'] },
    });

    expect(findBlockingNodeExportWarning(data, 'loon')).toEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('没有可导出到 loon 的节点'),
    }));
    expect(validateExportData(data, 'loon')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'node-grpc',
        level: 'partial',
        message: expect.stringContaining('传输层 grpc'),
      }),
      expect.objectContaining({
        groupId: 'auto',
        message: expect.stringContaining('gRPC Node'),
      }),
    ]));
  });

  it('warns and removes group references for unsupported Egern transports', () => {
    const node = makeNode('node-trojan-grpc', 'Trojan gRPC', {
      protocol: 'trojan',
      parsedConfig: {
        protocol: 'trojan',
        server: 'trojan-grpc.example.com',
        port: 443,
        password: 'secret',
        network: 'grpc',
        tls: true,
        extra: {},
      },
    });
    const data = makeExportData({
      nodes: [node],
      groups: [makeGroup('auto', 'Auto', [], { collectionIds: ['collection-auto'] })],
      collectionNodeNames: { 'collection-auto': ['Trojan gRPC'] },
    });

    expect(findBlockingNodeExportWarning(data, 'egern')).toEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('没有可导出到 egern 的节点'),
    }));
    expect(validateExportData(data, 'egern')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'node-trojan-grpc',
        level: 'partial',
        message: expect.stringContaining('传输层 grpc'),
      }),
      expect.objectContaining({
        groupId: 'auto',
        message: expect.stringContaining('Trojan gRPC'),
      }),
    ]));
  });

  it('silently normalizes MATCH to the final position', () => {
    const warnings = validateExportData(makeExportData({
      rules: [
        makeRule('match', 'proxy', 'MATCH', '', 0),
        makeRule('late', 'proxy', 'DOMAIN-SUFFIX', 'example.com', 1),
      ],
    }), 'mihomo');

    expect(warnings).toEqual([]);
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
      message: expect.stringContaining('PROCESS-NAME,Example.app 不兼容 shadowrocket'),
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
      message: expect.stringContaining('SCRIPT,script-path 不兼容 quantumultx'),
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

  it('ignores policy group, rule, and remote rule set warnings for node-only subscriptions', () => {
    const warnings = validateExportData(makeExportData({
      groups: [makeGroup('proxy', 'PROXY', ['missing-child'])],
      rules: [makeRule('rule-1', 'missing-rule-target', 'PROCESS-NAME', 'Example.app')],
      remoteSets: [makeRemoteSet('bad-url', 'missing-remote-target', { url: './local-rule.yaml', format: 'singbox' })],
    }), 'nodes_raw');

    expect(warnings).not.toContainEqual(expect.objectContaining({ groupId: 'proxy' }));
    expect(warnings).not.toContainEqual(expect.objectContaining({ ruleId: 'rule-1' }));
    expect(warnings).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('远程规则集') }));
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

  it('keeps ShadowsocksR in Mihomo but omits it from sing-box', () => {
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
    expect(findBlockingNodeExportWarning(makeExportData({ nodes: [node] }), 'singbox')).toEqual(
      expect.objectContaining({ client: 'singbox', level: 'unsupported' }),
    );
    expect(warnings).not.toContainEqual(expect.objectContaining({
      nodeId: 'node-ssr',
      message: expect.stringContaining('ssr'),
    }));
    expect(singboxWarnings).toContainEqual(expect.objectContaining({
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
        remediation: { target: 'sources', id: 'source-1' },
      }),
    ]));
  });

  it('does not report an exact remote rule set conversion as a warning', () => {
    const warnings = validateExportData(makeExportData({
      remoteSets: [makeRemoteSet('singbox-remote', 'proxy', { format: 'singbox' })],
    }), 'mihomo');

    expect(warnings).toEqual([]);
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

  it('keeps readiness warnings when compatibility warnings are disabled', () => {
    const warnings = resolveExportWarnings(makeExportData({
      nodes: [],
      rules: [
        makeRule('process', 'proxy', 'PROCESS-NAME', 'Example.app', 0),
        makeRule('match', 'proxy', 'MATCH', '', 999),
      ],
    }), 'shadowrocket', {
      showCompatibilityWarnings: false,
    });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('没有可导出的节点') }),
    ]));
    expect(warnings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining('PROCESS-NAME 不兼容 shadowrocket'),
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
    sourceOverrides: {},
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}
