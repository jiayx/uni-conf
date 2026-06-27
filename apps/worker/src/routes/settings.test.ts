import { describe, expect, it } from 'vitest'
import { validateSettingsPatch } from './settings'

describe('settings route helpers', () => {
  it('accepts valid settings patches', () => {
    expect(validateSettingsPatch({
      language: 'zh',
      theme: 'system',
      routingPolicyTemplate: 'common',
      routingOutletPreferences: {
        'builtin-ai': 'auto:country:US:url-test',
        'builtin-streaming': 'group:builtin-auto-select',
      },
      dnsMode: 'smart',
      exportNodeNamingMode: 'source_region_sequence',
      autoNodeGroupsEnabled: true,
      autoNodeGroupTypes: ['url-test', 'fallback'],
      autoNodeGroupKeys: ['country:US:url-test', 'tag:streaming:fallback'],
      autoNodeGroupIncludeFlag: false,
      showCompatibilityWarnings: true,
      enableAutoRefresh: true,
      autoRefreshInterval: 1440,
    })).toBeNull()
  })

  it('rejects invalid enum settings', () => {
    expect(validateSettingsPatch({ language: 'fr' as never })).toBe('invalid language')
    expect(validateSettingsPatch({ routingPolicyTemplate: 'custom' as never })).toBe('invalid routing policy template')
    expect(validateSettingsPatch({ routingOutletPreferences: [] as never })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': '' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'us-auto' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ dnsMode: 'system' as never })).toBe('invalid DNS mode')
    expect(validateSettingsPatch({ exportNodeNamingMode: 'random' as never })).toBe('invalid export node naming mode')
    expect(validateSettingsPatch({ autoNodeGroupTypes: ['url-test', 'random' as never] })).toBe('invalid auto node group type')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['US:url-test'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['country:usa:url-test'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['country:US:load-balance'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupsEnabled: 'true' as never })).toBe('invalid auto node groups enabled')
    expect(validateSettingsPatch({ autoNodeGroupIncludeFlag: 'true' as never })).toBe('invalid auto node group include flag')
    expect(validateSettingsPatch({ showCompatibilityWarnings: 1 as never })).toBe('invalid compatibility warnings setting')
    expect(validateSettingsPatch({ enableAutoRefresh: 1 as never })).toBe('invalid auto refresh setting')
  })

  it('rejects invalid auto refresh intervals', () => {
    expect(validateSettingsPatch({ autoRefreshInterval: 0 })).toBe('invalid auto refresh interval')
    expect(validateSettingsPatch({ autoRefreshInterval: Number.NaN })).toBe('invalid auto refresh interval')
  })
})
