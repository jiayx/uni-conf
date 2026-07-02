import { describe, expect, it } from 'vitest'
import type { ExportConfig, NodeCollection, ProxyNode } from '@uni-conf/types'
import {
  applyDefaultExportDedup,
  applyDefaultExportNodeNames,
  applyExportNodeNames,
  buildCollectionNodeNames,
  expandReferencedGroupRows,
  filterRowsByTargetGroup,
  resolveCollectionScopeIds,
} from './export-data'
import { applyCollectionTransforms } from './services/collection-transforms'

const baseConfig: ExportConfig = {
  id: 'export-1',
  name: 'Mihomo',
  format: 'mihomo',
  token: 'token',
  enabled: true,
  includeCollectionIds: [],
  includeGroupIds: [],
  includeRuleIds: [],
  includeRemoteSetIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const groupRows: Record<string, unknown>[] = [
  {
    id: 'streaming',
    name: 'Streaming',
    collection_ids: '[]',
    group_ids: '["proxy"]',
  },
  {
    id: 'proxy',
    name: 'PROXY',
    collection_ids: '[]',
    group_ids: '["us-auto","hk-auto"]',
  },
  {
    id: 'us-auto',
    name: 'US Auto',
    collection_ids: '["collection-us"]',
    group_ids: '[]',
  },
  {
    id: 'hk-auto',
    name: 'HK Auto',
    collection_ids: '["collection-hk"]',
    group_ids: '[]',
  },
]

describe('export data scoping', () => {
  it('expands selected groups to include referenced policy groups', () => {
    const rows = expandReferencedGroupRows(groupRows, ['streaming'])

    expect(rows.map(row => row.id)).toEqual(['streaming', 'proxy', 'us-auto', 'hk-auto'])
  })

  it('uses policy group collections for full client configs', () => {
    const scopeIds = resolveCollectionScopeIds(
      {
        ...baseConfig,
        includeCollectionIds: ['collection-excluded'],
      },
      groupRows
    )

    expect(scopeIds).toEqual(['collection-us', 'collection-hk'])
  })

  it('uses the default node pool when full client configs include global node outlets', () => {
    const scopeIds = resolveCollectionScopeIds(
      baseConfig,
      [
        ...groupRows,
        {
          id: 'builtin-all-nodes',
          name: '全部节点',
          collection_ids: '["builtin-default-node-pool"]',
          group_ids: '[]',
        },
      ]
    )

    expect(scopeIds).toEqual(['collection-us', 'collection-hk', 'builtin-default-node-pool'])
  })

  it('uses selected node groups for node subscription configs', () => {
    const scopeIds = resolveCollectionScopeIds(
      {
        ...baseConfig,
        format: 'nodes_raw',
        includeCollectionIds: ['collection-excluded'],
      },
      groupRows
    )

    expect(scopeIds).toEqual(['collection-excluded'])
  })

  it('filters rules and remote rule sets whose target group is not exported', () => {
    const filtered = filterRowsByTargetGroup(
      [
        { id: 'rule-1', target_group_id: 'proxy' },
        { id: 'rule-2', target_group_id: 'disabled' },
        { id: 'rule-3', targetGroupId: 'streaming' },
      ],
      new Set(['proxy', 'streaming'])
    )

    expect(filtered.map(row => row.id)).toEqual(['rule-1', 'rule-3'])
  })

  it('renames exported nodes with region, source, and sequence', () => {
    const renamed = applyDefaultExportNodeNames(
      [
        { id: 'node-1', source_id: 'source-a', name: 'HK 01', country_code: 'HK' },
        { id: 'node-2', source_id: 'source-a', name: 'HK 02', country_code: 'HK' },
        { id: 'node-3', source_id: 'source-b', name: 'Unknown' },
      ],
      new Map([
        ['source-a', 'Airport A'],
        ['source-b', '机场/B'],
      ])
    )

    expect(renamed.map(row => row.name)).toEqual([
      'HK - Airport A - 01',
      'HK - Airport A - 02',
      'Other - 机场-B - 01',
    ])
  })

  it('supports configurable exported node naming modes', () => {
    const rows = [
      { id: 'node-1', source_id: 'source-a', name: 'HK 01', country_code: 'HK' },
      { id: 'node-2', source_id: 'source-a', name: 'HK 02', country_code: 'HK' },
      { id: 'node-3', source_id: 'source-b', name: 'JP 01', country_code: 'JP' },
    ]
    const sources = new Map([
      ['source-a', 'Airport A'],
      ['source-b', 'Airport B'],
    ])

    expect(applyExportNodeNames(rows, sources, 'original').map(row => row.name)).toEqual([
      'HK 01',
      'HK 02',
      'JP 01',
    ])
    expect(applyExportNodeNames(rows, sources, 'region_sequence').map(row => row.name)).toEqual([
      'HK - 01',
      'HK - 02',
      'JP - 01',
    ])
    expect(applyExportNodeNames(rows, sources, 'source_region_sequence').map(row => row.name)).toEqual([
      'Airport A - HK - 01',
      'Airport A - HK - 02',
      'Airport B - JP - 01',
    ])
  })

  it('deduplicates exported nodes by full parsed config before naming', () => {
    const rows = applyDefaultExportDedup([
      { id: 'node-1', parsed_config: '{"protocol":"trojan","server":"same.example.com","port":443,"extra":{}}' },
      { id: 'node-2', parsed_config: '{"protocol":"trojan","server":"same.example.com","port":443,"extra":{}}' },
      { id: 'node-3', parsed_config: '{"protocol":"trojan","server":"other.example.com","port":443,"extra":{}}' },
    ])

    expect(rows.map(row => row.id)).toEqual(['node-1', 'node-3'])
  })

  it('falls back to protocol server and port when parsed config is unavailable', () => {
    const rows = applyDefaultExportDedup([
      { id: 'node-1', protocol: 'trojan', server: 'same.example.com', port: 443 },
      { id: 'node-2', protocol: 'trojan', server: 'same.example.com', port: 443 },
      { id: 'node-3', protocol: 'vless', server: 'same.example.com', port: 443 },
    ])

    expect(rows.map(row => row.id)).toEqual(['node-1', 'node-3'])
  })

  it('applies collection renames before collection dedup so preview and export stay aligned', () => {
    const collection = makeCollection({
      dedup: 'name',
      renames: [
        { id: 'strip-number', type: 'regex', pattern: '\\s+0[12]$', replacement: '', enabled: true, order: 0 },
      ],
      sort: 'manual',
    })

    const nodes = applyCollectionTransforms([
      makeNode('node-1', 'HK 01'),
      makeNode('node-2', 'HK 02'),
    ], collection)

    expect(nodes.map(node => [node.id, node.name])).toEqual([
      ['node-1', 'HK'],
    ])
  })

  it('builds collection node names from final exported names', () => {
    const collectionRows = new Map([
      ['collection-hk', [
        { id: 'node-1', name: 'Original HK 01' },
        { id: 'node-2', name: 'Original HK 02' },
      ]],
    ])
    const names = buildCollectionNodeNames(collectionRows, [
      { id: 'node-1', name: 'HK - Airport A - 01' },
      { id: 'node-2', name: 'HK - Airport A - 02' },
    ])

    expect(names).toEqual({
      'collection-hk': ['HK - Airport A - 01', 'HK - Airport A - 02'],
    })
  })

  it('maps deduplicated collection members to the retained exported node name', () => {
    const duplicateConfig = '{"protocol":"trojan","server":"same.example.com","port":443,"extra":{}}'
    const collectionRows = new Map([
      ['collection-a', [
        { id: 'node-a', name: 'A 01', parsed_config: duplicateConfig },
      ]],
      ['collection-b', [
        { id: 'node-b', name: 'B 01', parsed_config: duplicateConfig },
      ]],
    ])
    const exportedRows = applyExportNodeNames(
      applyDefaultExportDedup([
        { id: 'node-a', source_id: 'source-a', name: 'A 01', country_code: 'US', parsed_config: duplicateConfig },
        { id: 'node-b', source_id: 'source-b', name: 'B 01', country_code: 'US', parsed_config: duplicateConfig },
      ]),
      new Map([['source-a', 'Airport A'], ['source-b', 'Airport B']]),
      'smart'
    )

    expect(exportedRows.map((row) => row.id)).toEqual(['node-a'])
    expect(buildCollectionNodeNames(collectionRows, exportedRows)).toEqual({
      'collection-a': ['US - Airport A - 01'],
      'collection-b': ['US - Airport A - 01'],
    })
  })
})

function makeCollection(patch: Partial<NodeCollection>): NodeCollection {
  return {
    id: 'collection-1',
    name: 'Collection',
    sourceIds: [],
    nodeIds: [],
    filters: [],
    renames: [],
    dedup: 'name',
    sort: 'country',
    sortCountryOrder: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function makeNode(id: string, name: string): ProxyNode {
  return {
    id,
    sourceId: 'source-a',
    name,
    protocol: 'trojan',
    server: `${id}.example.com`,
    port: 443,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol: 'trojan', server: `${id}.example.com`, port: 443, extra: {} },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
