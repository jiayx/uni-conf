import { describe, expect, it } from 'vitest'
import type { ExportConfig } from '@uni-conf/types'
import { expandReferencedGroupRows, resolveCollectionScopeIds } from './export-data'

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
})
