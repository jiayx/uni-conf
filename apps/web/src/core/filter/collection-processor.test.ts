import { describe, expect, it } from 'vitest'
import type { NodeCollection, NormalizedProxyConfig, ProxyNode } from '@uni-conf/types'
import { processCollection } from './collection-processor'
import { dedupNodes } from './node-dedup'
import { applyFilter, filterNodes } from './node-filter'
import { applyRename, renameNodes } from './node-rename'
import { sortNodes } from './node-sort'

const createdAt = '2026-01-01T00:00:00.000Z'

function node(id: string, patch: Partial<ProxyNode> = {}): ProxyNode {
  return {
    id,
    sourceId: 'source-a',
    name: id,
    protocol: 'trojan',
    server: `${id}.example.com`,
    port: 443,
    country: undefined,
    countryCode: undefined,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol: 'trojan', server: `${id}.example.com`, port: 443, extra: {} },
    isManual: false,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  }
}

function collection(patch: Partial<NodeCollection> = {}): NodeCollection {
  return {
    id: 'collection-1',
    name: 'Collection',
    sourceIds: [],
    nodeIds: [],
    filters: [],
    renames: [],
    dedup: 'name',
    sort: 'manual',
    sortCountryOrder: [],
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  }
}

describe('collection filter pipeline', () => {
  it('filters scalar and tag fields with all common operators', () => {
    const nodes = [
      node('hk', { name: 'HK Streaming', countryCode: 'HK', tags: ['streaming', 'unlock'] }),
      node('jp', { name: 'JP Native', countryCode: 'JP', tags: ['native-ip'] }),
    ]

    expect(filterNodes(nodes, [{ id: 'f', field: 'name', operator: 'contains', value: 'stream', enabled: true }]).map(n => n.id)).toEqual(['hk'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'name', operator: 'not_contains', value: 'stream', enabled: true }]).map(n => n.id)).toEqual(['jp'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'countryCode', operator: 'equals', value: 'HK', enabled: true }]).map(n => n.id)).toEqual(['hk'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'countryCode', operator: 'not_equals', value: 'HK', enabled: true }]).map(n => n.id)).toEqual(['jp'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'name', operator: 'regex', value: '^JP', enabled: true }]).map(n => n.id)).toEqual(['jp'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'name', operator: 'not_regex', value: '^JP', enabled: true }]).map(n => n.id)).toEqual(['hk'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'tag', operator: 'in', value: ['unlock'], enabled: true }]).map(n => n.id)).toEqual(['hk'])
    expect(filterNodes(nodes, [{ id: 'f', field: 'tag', operator: 'not_in', value: ['unlock'], enabled: true }]).map(n => n.id)).toEqual(['jp'])
  })

  it('handles disabled filters, invalid regexes, and empty filters defensively', () => {
    const sample = node('hk', { name: 'HK Streaming', tags: ['streaming'] })

    expect(applyFilter(sample, { id: 'off', field: 'name', operator: 'contains', value: 'JP', enabled: false })).toBe(true)
    expect(applyFilter(sample, { id: 'bad-regex', field: 'name', operator: 'regex', value: '[', enabled: true })).toBe(false)
    expect(applyFilter(sample, { id: 'bad-not-regex', field: 'name', operator: 'not_regex', value: '[', enabled: true })).toBe(true)
    expect(filterNodes([sample], [])).toEqual([sample])
  })

  it('renames nodes and numbers duplicate final names', () => {
    const renamed = renameNodes([
      node('hk-1', { name: '🇭🇰 HK 01' }),
      node('hk-2', { name: '🇭🇰 HK 02' }),
    ], [
      { id: 'strip', type: 'strip_emoji', enabled: true, order: 0 },
      { id: 'regex', type: 'regex', pattern: 'HK \\d+', replacement: 'HK', enabled: true, order: 1 },
      { id: 'number', type: 'auto_number', enabled: true, order: 2 },
    ])

    expect(renamed.map(item => item.name)).toEqual(['HK 01', 'HK 02'])
  })

  it('handles every rename strategy and malformed rename input', () => {
    expect(applyRename('HK 01', { id: 'replace-empty', type: 'replace', enabled: true, order: 0 })).toBe('HK 01')
    expect(applyRename('HK 01', { id: 'replace', type: 'replace', pattern: 'HK', replacement: 'Hong Kong', enabled: true, order: 0 })).toBe('Hong Kong 01')
    expect(applyRename('HK 01', { id: 'regex-empty', type: 'regex', enabled: true, order: 0 })).toBe('HK 01')
    expect(applyRename('HK 01', { id: 'regex-bad', type: 'regex', pattern: '[', replacement: '', enabled: true, order: 0 })).toBe('HK 01')
    expect(applyRename('HK 01', { id: 'prefix', type: 'prefix', replacement: 'Auto ', enabled: true, order: 0 })).toBe('Auto HK 01')
    expect(applyRename('HK 01', { id: 'suffix', type: 'suffix', replacement: ' Auto', enabled: true, order: 0 })).toBe('HK 01 Auto')
    expect(applyRename('HK 01', { id: 'off', type: 'suffix', replacement: ' Auto', enabled: false, order: 0 })).toBe('HK 01')
    expect(applyRename('HK 01', { id: 'unknown', type: 'unknown' as never, enabled: true, order: 0 })).toBe('HK 01')
  })

  it('deduplicates and sorts nodes with stable strategy semantics', () => {
    const sharedConfig: NormalizedProxyConfig = { protocol: 'trojan', server: 'same.example.com', port: 443, extra: {} }
    const nodes = [
      node('b', { name: 'B', sourceId: 'source-b', protocol: 'vmess', server: 'same.example.com', countryCode: 'US', parsedConfig: sharedConfig }),
      node('a', { name: 'A', sourceId: 'source-a', protocol: 'trojan', server: 'same.example.com', countryCode: 'HK', parsedConfig: sharedConfig }),
      node('c', { name: 'C', sourceId: 'source-c', protocol: 'trojan', server: 'other.example.com', countryCode: 'JP', parsedConfig: sharedConfig }),
    ]

    expect(dedupNodes(nodes, 'server_port').map(item => item.id)).toEqual(['b', 'c'])
    expect(dedupNodes(nodes, 'protocol_server_port').map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(dedupNodes(nodes, 'name').map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(dedupNodes(nodes, 'full_config').map(item => item.id)).toEqual(['b'])
    expect(sortNodes(nodes, 'country').map(item => item.id)).toEqual(['a', 'c', 'b'])
    expect(sortNodes(nodes, 'country', ['US', 'OTHER']).map(item => item.id)).toEqual(['b', 'a', 'c'])
    expect(sortNodes(nodes, 'source').map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(sortNodes(nodes, 'protocol').map(item => item.id)).toEqual(['a', 'c', 'b'])
    expect(sortNodes(nodes, 'manual').map(item => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('runs source scoping, filters, renames, dedupe, and sorting in order', () => {
    const result = processCollection([
      node('hk-1', { name: 'HK Netflix A', sourceId: 'source-a', server: 'same.example.com', countryCode: 'HK', tags: ['streaming'] }),
      node('hk-2', { name: 'HK Netflix B', sourceId: 'source-a', server: 'same.example.com', countryCode: 'HK', tags: ['streaming'] }),
      node('jp-1', { name: 'JP Normal', sourceId: 'source-b', server: 'jp.example.com', countryCode: 'JP' }),
    ], collection({
      sourceIds: ['source-a'],
      filters: [{ id: 'streaming', field: 'tag', operator: 'in', value: ['streaming'], enabled: true }],
      renames: [{ id: 'rename', type: 'regex', pattern: 'Netflix [AB]', replacement: 'Netflix', enabled: true, order: 0 }],
      dedup: 'server_port',
      sort: 'name',
    }))

    expect(result.map(item => item.name)).toEqual(['HK Netflix'])
  })
})
