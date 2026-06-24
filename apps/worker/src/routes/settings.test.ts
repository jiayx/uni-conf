import { describe, expect, it } from 'vitest'
import { validateSettingsPatch } from './settings'

describe('settings route helpers', () => {
  it('accepts valid settings patches', () => {
    expect(validateSettingsPatch({
      language: 'zh',
      theme: 'system',
      routingPolicyTemplate: 'common',
      dnsMode: 'smart',
      exportNodeNamingMode: 'source_region_sequence',
      autoNodeGroupTypes: ['url-test', 'fallback'],
      autoRefreshInterval: 1440,
    })).toBeNull()
  })

  it('rejects invalid enum settings', () => {
    expect(validateSettingsPatch({ language: 'fr' as never })).toBe('invalid language')
    expect(validateSettingsPatch({ routingPolicyTemplate: 'custom' as never })).toBe('invalid routing policy template')
    expect(validateSettingsPatch({ dnsMode: 'system' as never })).toBe('invalid DNS mode')
    expect(validateSettingsPatch({ exportNodeNamingMode: 'random' as never })).toBe('invalid export node naming mode')
    expect(validateSettingsPatch({ autoNodeGroupTypes: ['url-test', 'random' as never] })).toBe('invalid auto node group type')
  })

  it('rejects invalid auto refresh intervals', () => {
    expect(validateSettingsPatch({ autoRefreshInterval: 0 })).toBe('invalid auto refresh interval')
    expect(validateSettingsPatch({ autoRefreshInterval: Number.NaN })).toBe('invalid auto refresh interval')
  })
})
