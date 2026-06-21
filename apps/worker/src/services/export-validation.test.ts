import { describe, expect, it } from 'vitest';
import type { ExportData } from '../export-data';
import { validateExportData } from './export-validation';

const createdAt = '2026-01-01T00:00:00.000Z';

describe('export validation', () => {
  it('warns about empty node exports and missing MATCH fallback', () => {
    const warnings = validateExportData(makeExportData({ nodes: [], rules: [] }), 'mihomo');

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'unsupported', message: expect.stringContaining('没有可导出的节点') }),
      expect.objectContaining({ level: 'partial', message: expect.stringContaining('缺少 MATCH') }),
    ]));
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
});

function makeExportData(patch: Partial<ExportData> = {}): ExportData {
  const groups = patch.groups ?? [makeGroup('proxy', 'PROXY')];
  return {
    nodeRows: [],
    groupRows: [],
    ruleRows: [],
    remoteSetRows: [],
    nodes: patch.nodes ?? [makeNode('node-1', 'HK 01')],
    groups,
    rules: patch.rules ?? [makeRule('match', groups[0]!.id, 'MATCH', '')],
    remoteSets: patch.remoteSets ?? [],
    collectionNodeNames: {},
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

function makeGroup(id: string, name: string, groupIds: string[] = []): ExportData['groups'][number] {
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
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}
