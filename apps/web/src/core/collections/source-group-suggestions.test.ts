import { describe, expect, it } from 'vitest'
import type { NodeCollection, ProxyNode, ProxySource } from '@uni-conf/types'
import {
  buildSourceGroupSuggestions,
  makeSourceNodeGroupMarker,
  mapUpstreamGroupType,
  parseSourceNodeGroupMarker,
} from './source-group-suggestions'

const createdAt = '2026-01-01T00:00:00.000Z'

describe('source group suggestions', () => {
  it('matches upstream group members to nodes from the same source', () => {
    const suggestions = buildSourceGroupSuggestions(
      [
        makeSource('source-b', 'Airport B', [{ name: 'B Auto', type: 'url-test', memberNames: ['B 01'] }]),
        makeSource('source-a', 'Airport A', [{ name: 'A Select', type: 'select', memberNames: ['A 01', 'Shared'] }]),
      ],
      [
        makeNode('node-a-1', 'source-a', 'A 01'),
        makeNode('node-a-shared', 'source-a', 'Shared'),
        makeNode('node-b-1', 'source-b', 'B 01'),
        makeNode('node-other-shared', 'source-b', 'Shared'),
      ],
      []
    )

    expect(suggestions.map(item => [item.name, item.nodeIds])).toEqual([
      ['Airport A / A Select', ['node-a-1', 'node-a-shared']],
      ['Airport B / B Auto', ['node-b-1']],
    ])
  })

  it('marks already imported upstream groups and keeps empty member suggestions visible', () => {
    const marker = makeSourceNodeGroupMarker('source-a', 'A Select')
    const suggestions = buildSourceGroupSuggestions(
      [
        makeSource('source-a', 'Airport A', [
          { name: 'A Select', type: 'select', memberNames: ['missing'] },
        ]),
      ],
      [],
      [makeCollection('collection-a', marker)]
    )

    expect(parseSourceNodeGroupMarker(marker)).toBe('source-a:A%20Select')
    expect(suggestions).toEqual([
      expect.objectContaining({
        key: 'source-a:A%20Select',
        nodeIds: [],
        exists: true,
      }),
    ])
  })

  it('maps upstream group types to supported node group types', () => {
    expect(mapUpstreamGroupType('select')).toBe('select')
    expect(mapUpstreamGroupType('selector')).toBe('select')
    expect(mapUpstreamGroupType('fallback')).toBe('fallback')
    expect(mapUpstreamGroupType('load-balance')).toBe('url-test')
    expect(mapUpstreamGroupType(undefined)).toBe('url-test')
  })
})

function makeSource(
  id: string,
  name: string,
  groups: ProxySource['groups']
): ProxySource {
  return {
    id,
    name,
    type: 'url',
    format: 'auto',
    enabled: true,
    nodeCount: 0,
    tags: [],
    groups,
    createdAt,
    updatedAt: createdAt,
  }
}

function makeNode(id: string, sourceId: string, name: string): ProxyNode {
  return {
    id,
    sourceId,
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
  }
}

function makeCollection(id: string, notes: string): NodeCollection {
  return {
    id,
    name: id,
    sourceIds: [],
    nodeIds: [],
    filters: [],
    renames: [],
    dedup: 'full_config',
    sort: 'manual',
    enabled: true,
    notes,
    createdAt,
    updatedAt: createdAt,
  }
}
