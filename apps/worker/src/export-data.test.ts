import { describe, expect, it } from 'vitest'
import type { ExportConfig } from '@uni-conf/types'
import {
  applyDefaultExportDedup,
  applyDefaultExportNodeNames,
  buildCollectionNodeNames,
  expandReferencedGroupRows,
  resolveCollectionScopeIds,
} from './export-data'

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

  it('exports all nodes when full client configs include an all-node outlet group', () => {
    const scopeIds = resolveCollectionScopeIds(
      baseConfig,
      [
        ...groupRows,
        {
          id: 'builtin-all-nodes',
          name: '全部节点',
          collection_ids: '[]',
          group_ids: '[]',
        },
      ]
    )

    expect(scopeIds).toEqual([])
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
})
