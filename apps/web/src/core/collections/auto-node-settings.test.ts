import { describe, expect, it } from 'vitest'
import {
  buildAutoNodeGroupSettingsPatch,
  buildAutoNodeGroupKeysForSuggestions,
  buildAutoNodeGroupTypeSettingsPatch,
  buildAutoNodeTagSuggestions,
  parseAutoNodeGroupKey,
  normalizeAutoNodeGroupTypeSelection,
  toggleAllAutoNodeGroupScopes,
  toggleAutoNodeGroupTypeSelection,
} from './auto-node-settings'
import type { ProxyNode } from '@uni-conf/types'

describe('auto node group settings helpers', () => {
  it('normalizes generated group types in a stable UI order', () => {
    expect(normalizeAutoNodeGroupTypeSelection(['fallback', 'url-test', 'fallback', 'select'])).toEqual([
      'select',
      'url-test',
      'fallback',
    ])
  })

  it('allows clearing every generated group type instead of restoring url-test', () => {
    expect(toggleAutoNodeGroupTypeSelection(['url-test'], 'url-test')).toEqual([])
    expect(buildAutoNodeGroupTypeSettingsPatch(['url-test'], 'url-test')).toEqual({
      autoNodeGroupsEnabled: false,
      autoNodeGroupTypes: [],
    })
  })

  it('disables auto node groups when the auto generation panel has no selected type or key', () => {
    expect(buildAutoNodeGroupSettingsPatch({
      selectedTypes: [],
      selectedKeys: ['country:US:url-test'],
      includeFlag: true,
    })).toEqual({
      autoNodeGroupsEnabled: false,
      autoNodeGroupTypes: [],
      autoNodeGroupKeys: ['country:US:url-test'],
      autoNodeGroupIncludeFlag: true,
    })

    expect(buildAutoNodeGroupSettingsPatch({
      selectedTypes: ['url-test'],
      selectedKeys: [],
      includeFlag: false,
    })).toEqual({
      autoNodeGroupsEnabled: false,
      autoNodeGroupTypes: ['url-test'],
      autoNodeGroupKeys: [],
      autoNodeGroupIncludeFlag: false,
    })
  })

  it('suggests tag based auto node groups and excludes high multiplier nodes', () => {
    expect(buildAutoNodeTagSuggestions([
      node('hk-streaming', ['streaming']),
      node('jp-unlock', ['unlock']),
      node('us-native', ['native-ip']),
      node('sg-residential-high', ['residential', 'high-multiplier']),
      node('plain', []),
    ])).toEqual([
      { key: 'streaming', label: 'Streaming / Unlock', count: 2 },
      { key: 'native', label: 'Native / Residential', count: 1 },
    ])
  })

  it('parses auto node group keys with normalized country codes', () => {
    expect(parseAutoNodeGroupKey('country:us:url-test')).toEqual({
      scope: 'country',
      countryCode: 'US',
      type: 'url-test',
      key: 'country:US:url-test',
    })
    expect(parseAutoNodeGroupKey('tag:streaming:fallback')).toEqual({
      scope: 'tag',
      tagKey: 'streaming',
      type: 'fallback',
      key: 'tag:streaming:fallback',
    })
  })

  it('builds default auto node group keys from country and tag suggestions', () => {
    expect([...buildAutoNodeGroupKeysForSuggestions({
      countryCodes: ['us', 'HK'],
      tagKeys: ['streaming', 'native'],
      types: ['url-test'],
    })]).toEqual([
      'country:US:url-test',
      'country:HK:url-test',
      'tag:streaming:url-test',
      'tag:native:url-test',
    ])
  })

  it('selects or clears every visible country without changing hidden selections', () => {
    expect([...toggleAllAutoNodeGroupScopes(['TW'], ['US', 'HK'])]).toEqual(['TW', 'US', 'HK'])
    expect([...toggleAllAutoNodeGroupScopes(['TW', 'US', 'HK'], ['US', 'HK'])]).toEqual(['TW'])
  })
})

function node(id: string, tags: string[]): ProxyNode {
  return {
    id,
    sourceId: 'source',
    name: id,
    protocol: 'ss',
    server: `${id}.example.com`,
    port: 443,
    enabled: true,
    tags,
    rawConfig: {},
    parsedConfig: {
      protocol: 'ss',
      server: `${id}.example.com`,
      port: 443,
      extra: {},
    },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
