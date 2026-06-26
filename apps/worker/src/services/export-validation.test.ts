import { describe, expect, it } from 'vitest';
import type { ExportData } from '../export-data';
import { findEmptyNodeExportWarning, resolveExportWarnings, validateExportData } from './export-validation';

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
  return {
    nodeRows: [],
    groupRows: [],
    ruleRows: [],
    remoteSetRows: [],
    sourceRows: [],
    sources: patch.sources ?? [],
    nodes: patch.nodes ?? [makeNode('node-1', 'HK 01')],
    groups,
    rules: patch.rules ?? [makeRule('match', groups[0]!.id, 'MATCH', '')],
    remoteSets: patch.remoteSets ?? [],
    collectionNodeNames: {},
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

function makeNode(id: string, name: string): ExportData['nodes'][number] {
  return {
    id,
    sourceId: 'source-1',
    name,
    protocol: 'trojan',
    server: `${id}.example.com`,
    port: 443,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol: 'trojan', server: `${id}.example.com`, port: 443, extra: {} },
    isManual: false,
    createdAt,
    updatedAt: createdAt,
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
