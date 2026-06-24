import { describe, expect, it } from 'vitest'
import { isManagedRemoteRuleSet, isValidRuleSetBehavior, isValidRuleSetFormat } from './remote-rule-sets'

describe('remote rule set routes', () => {
  it('treats provider presets as managed rows', () => {
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: 'ai' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: 'uni-conf', preset_id: 'telegram' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: null, preset_id: null })).toBe(false)
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: null })).toBe(false)
  })

  it('validates rule set format and behavior values', () => {
    expect(isValidRuleSetFormat('mihomo')).toBe(true)
    expect(isValidRuleSetFormat('singbox')).toBe(true)
    expect(isValidRuleSetFormat('yaml')).toBe(false)
    expect(isValidRuleSetFormat('')).toBe(false)

    expect(isValidRuleSetBehavior('domain')).toBe(true)
    expect(isValidRuleSetBehavior('ipcidr')).toBe(true)
    expect(isValidRuleSetBehavior('classical')).toBe(true)
    expect(isValidRuleSetBehavior('text')).toBe(false)
  })
})
