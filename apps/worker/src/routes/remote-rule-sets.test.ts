import { describe, expect, it } from 'vitest'
import { isManagedRemoteRuleSet, isValidRuleSetBehavior, isValidRuleSetFormat, validateRemoteRuleSetWrite } from './remote-rule-sets'

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

  it('normalizes remote rule set writes', () => {
    expect(validateRemoteRuleSetWrite({
      name: '  AI Rules  ',
      url: ' https://example.com/ai.list ',
      format: 'mihomo',
      behavior: 'classical',
      targetGroupId: ' builtin-ai ',
      updateInterval: 12,
      sortOrder: 40,
      notes: ' note ',
      presetSource: 'quixotic',
      presetId: 'ai',
    }, { create: true })).toEqual({
      valid: true,
      name: 'AI Rules',
      url: 'https://example.com/ai.list',
      format: 'mihomo',
      behavior: 'classical',
      targetGroupId: 'builtin-ai',
      updateInterval: 12,
      enabled: true,
      sortOrder: 40,
      lastUpdated: undefined,
      notes: 'note',
    })
  })

  it('rejects malformed remote rule set writes', () => {
    expect(validateRemoteRuleSetWrite({ name: 'Missing fields' }, { create: true })).toEqual({
      valid: false,
      error: 'url is required',
    })
    expect(validateRemoteRuleSetWrite({ url: './local.list' }, { create: false })).toEqual({
      valid: false,
      error: 'url must be an http(s) URL',
    })
    expect(validateRemoteRuleSetWrite({ updateInterval: 0 }, { create: false })).toEqual({
      valid: false,
      error: 'updateInterval must be a positive integer',
    })
    expect(validateRemoteRuleSetWrite({ sortOrder: 1.5 }, { create: false })).toEqual({
      valid: false,
      error: 'sortOrder must be an integer',
    })
  })
})
