import { describe, expect, it } from 'vitest'
import type { ExportConfig, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import { exportConfigScopeSummary } from './scope-summary'

const createdAt = '2026-01-01T00:00:00.000Z'
const t = createTestT({
  'export.scope_collections': '节点组',
  'export.scope_groups': '策略组与出口',
  'export.scope_rules': '手动规则',
  'export.scope_remote_sets': '兼容分流规则集',
  'export.scope_all_enabled': '{{label}}: 全部启用 {{count}}',
  'export.scope_selected': '{{label}}: 已选 {{selected}}/{{count}}',
})

describe('export config scope summary', () => {
  it('summarizes the zero-setup default scope with enabled and compatible items only', () => {
    expect(exportConfigScopeSummary(
      makeConfig({ format: 'singbox' }),
      [
        makeCollection('collection-us', true),
        makeCollection('collection-disabled', false),
      ],
      [
        makeGroup('builtin-proxy', true),
        makeGroup('disabled-policy', false),
      ],
      [
        makeRule('rule-enabled', true),
        makeRule('rule-disabled', false),
      ],
      [
        makeRemoteSet('remote-singbox', true, 'singbox'),
        makeRemoteSet('remote-mihomo', true, 'mihomo'),
        makeRemoteSet('remote-disabled', false, 'singbox'),
      ],
      t
    )).toBe('节点组: 全部启用 1 / 策略组与出口: 全部启用 1 / 手动规则: 全部启用 1 / 兼容分流规则集: 全部启用 2')
  })

  it('shows selected scope counts against the eligible export pool', () => {
    expect(exportConfigScopeSummary(
      makeConfig({
        includeCollectionIds: ['collection-us'],
        includeGroupIds: ['builtin-proxy'],
        includeRuleIds: ['rule-enabled'],
        includeRemoteSetIds: ['remote-singbox'],
        format: 'singbox',
      }),
      [makeCollection('collection-us', true), makeCollection('collection-hk', true)],
      [makeGroup('builtin-proxy', true), makeGroup('builtin-ai', true)],
      [makeRule('rule-enabled', true), makeRule('rule-ai', true)],
      [makeRemoteSet('remote-singbox', true, 'singbox'), makeRemoteSet('remote-mihomo', true, 'mihomo')],
      t
    )).toBe('节点组: 已选 1/2 / 策略组与出口: 已选 1/2 / 手动规则: 已选 1/2 / 兼容分流规则集: 已选 1/2')
  })

  it('matches worker export target filtering when groups are scoped', () => {
    expect(exportConfigScopeSummary(
      makeConfig({
        includeGroupIds: ['builtin-streaming'],
        format: 'singbox',
      }),
      [makeCollection('collection-us', true)],
      [
        makeGroup('builtin-streaming', true, ['builtin-proxy']),
        makeGroup('builtin-proxy', true),
        makeGroup('builtin-ai', true),
        makeGroup('disabled-policy', false),
      ],
      [
        makeRule('rule-streaming', true, 'builtin-streaming'),
        makeRule('rule-proxy', true, 'builtin-proxy'),
        makeRule('rule-ai', true, 'builtin-ai'),
        makeRule('rule-disabled-target', true, 'disabled-policy'),
      ],
      [
        makeRemoteSet('remote-streaming', true, 'singbox', 'builtin-streaming'),
        makeRemoteSet('remote-proxy', true, 'singbox', 'builtin-proxy'),
        makeRemoteSet('remote-ai', true, 'singbox', 'builtin-ai'),
        makeRemoteSet('remote-disabled-target', true, 'singbox', 'disabled-policy'),
      ],
      t
    )).toBe('节点组: 全部启用 1 / 策略组与出口: 已选 2/3 / 手动规则: 全部启用 2 / 兼容分流规则集: 全部启用 2')
  })

  it('counts selected scopes by the effective exportable items', () => {
    expect(exportConfigScopeSummary(
      makeConfig({
        includeCollectionIds: ['collection-us', 'collection-disabled'],
        includeGroupIds: ['builtin-streaming'],
        includeRuleIds: ['rule-streaming', 'rule-disabled', 'rule-ai'],
        includeRemoteSetIds: ['remote-streaming', 'remote-disabled', 'remote-mihomo', 'remote-ai'],
        format: 'singbox',
      }),
      [
        makeCollection('collection-us', true),
        makeCollection('collection-disabled', false),
      ],
      [
        makeGroup('builtin-streaming', true, ['builtin-proxy']),
        makeGroup('builtin-proxy', true),
        makeGroup('builtin-ai', true),
      ],
      [
        makeRule('rule-streaming', true, 'builtin-streaming'),
        makeRule('rule-disabled', false, 'builtin-streaming'),
        makeRule('rule-ai', true, 'builtin-ai'),
      ],
      [
        makeRemoteSet('remote-streaming', true, 'singbox', 'builtin-streaming'),
        makeRemoteSet('remote-disabled', false, 'singbox', 'builtin-streaming'),
        makeRemoteSet('remote-mihomo', true, 'mihomo', 'builtin-streaming'),
        makeRemoteSet('remote-ai', true, 'singbox', 'builtin-ai'),
      ],
      t
    )).toBe('节点组: 已选 1/1 / 策略组与出口: 已选 2/3 / 手动规则: 已选 1/1 / 兼容分流规则集: 已选 2/2')
  })
})

function createTestT(messages: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>): string => {
    let text = messages[key] ?? key
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(value))
    }
    return text
  }
}

function makeConfig(patch: Partial<ExportConfig> = {}): ExportConfig {
  return {
    id: 'export-1',
    name: 'Default',
    format: 'mihomo',
    token: 'token',
    enabled: true,
    includeCollectionIds: [],
    includeGroupIds: [],
    includeRuleIds: [],
    includeRemoteSetIds: [],
    createdAt,
    updatedAt: createdAt,
    ...patch,
  }
}

function makeCollection(id: string, enabled: boolean): NodeCollection {
  return {
    id,
    name: id,
    sourceIds: [],
    nodeIds: [],
    filters: [],
    renames: [],
    dedup: 'full_config',
    sort: 'name',
    enabled,
    createdAt,
    updatedAt: createdAt,
  }
}

function makeGroup(id: string, enabled: boolean, groupIds: string[] = []): ProxyGroup {
  return {
    id,
    name: id,
    type: 'select',
    collectionIds: [],
    groupIds,
    builtins: [],
    enabled,
    order: 0,
    isBuiltin: true,
    createdAt,
    updatedAt: createdAt,
  }
}

function makeRule(id: string, enabled: boolean, targetGroupId = 'builtin-proxy'): ProxyRule {
  return {
    id,
    type: 'DOMAIN-SUFFIX',
    payload: 'example.com',
    targetGroupId,
    enabled,
    order: 0,
    compatibility: [],
    createdAt,
    updatedAt: createdAt,
  }
}

function makeRemoteSet(id: string, enabled: boolean, format: RemoteRuleSet['format'], targetGroupId = 'builtin-proxy'): RemoteRuleSet {
  return {
    id,
    name: id,
    url: `https://example.com/${id}`,
    format,
    behavior: 'classical',
    sourceOverrides: {},
    targetGroupId,
    updateInterval: 24,
    enabled,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
  }
}
