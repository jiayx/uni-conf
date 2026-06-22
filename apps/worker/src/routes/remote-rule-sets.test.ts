import { describe, expect, it } from 'vitest'
import { isManagedRemoteRuleSet } from './remote-rule-sets'

describe('remote rule set routes', () => {
  it('treats provider presets as managed rows', () => {
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: 'ai' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: 'uni-conf', preset_id: 'telegram' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: null, preset_id: null })).toBe(false)
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: null })).toBe(false)
  })
})
