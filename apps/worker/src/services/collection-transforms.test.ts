import { describe, expect, it } from 'vitest';
import type { NodeCollection, ProxyNode } from '@uni-conf/types';
import { applyCollectionTransforms } from './collection-transforms';

const createdAt = '2026-01-01T00:00:00.000Z';

describe('collection transforms', () => {
  it('applies filters, renames, deduplication, and sorting in preview/export order', () => {
    const collection = makeCollection({
      filters: [
        { id: 'tag', field: 'tag', operator: 'in', value: ['streaming'], enabled: true },
      ],
      renames: [
        { id: 'strip-number', type: 'regex', pattern: '\\s+0[12]$', replacement: '', enabled: true, order: 0 },
      ],
      dedup: 'name',
      sort: 'manual',
    });

    const nodes = applyCollectionTransforms([
      makeNode('node-1', 'HK 01', ['streaming']),
      makeNode('node-2', 'HK 02', ['streaming']),
      makeNode('node-3', 'JP 01', ['native']),
    ], collection);

    expect(nodes.map((node) => [node.id, node.name])).toEqual([
      ['node-1', 'HK'],
    ]);
  });

  it('uses the same country standardization and duplicate numbering for every caller', () => {
    const collection = makeCollection({
      renames: [
        { id: 'country', type: 'standardize_country', enabled: true, order: 0 },
        { id: 'number', type: 'auto_number', enabled: true, order: 1 },
      ],
      dedup: 'full_config',
      sort: 'manual',
    });

    const nodes = applyCollectionTransforms([
      makeNode('node-1', '🇭🇰 HK Auto', [], 'hk-1.example.com'),
      makeNode('node-2', 'Hong Kong Auto', [], 'hk-2.example.com'),
    ], collection);

    expect(nodes.map((node) => node.name)).toEqual([
      '香港 Auto 01',
      '香港 Auto 02',
    ]);
  });
});

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
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

function makeNode(id: string, name: string, tags: string[] = [], server = `${id}.example.com`): ProxyNode {
  return {
    id,
    sourceId: 'source-a',
    name,
    protocol: 'trojan',
    server,
    port: 443,
    countryCode: 'HK',
    enabled: true,
    tags,
    rawConfig: {},
    parsedConfig: { protocol: 'trojan', server, port: 443, extra: {} },
    isManual: false,
    createdAt,
    updatedAt: createdAt,
  };
}
