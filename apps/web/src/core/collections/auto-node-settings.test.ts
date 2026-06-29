import { describe, expect, it } from 'vitest'
import {
  buildAutoNodeGroupSettingsPatch,
  buildAutoNodeGroupTypeSettingsPatch,
  normalizeAutoNodeGroupTypeSelection,
  toggleAutoNodeGroupTypeSelection,
} from './auto-node-settings'

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
})
