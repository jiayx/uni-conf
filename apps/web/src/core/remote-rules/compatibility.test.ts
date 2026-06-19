import { describe, expect, it } from 'vitest'
import { buildQuixoticRuleSetUrl } from './quixotic-presets'
import { describeCompatibleRuleSetFormats, isRuleSetFormatCompatible } from './compatibility'

describe('remote rule set compatibility', () => {
  it('maps QuixoticHeart presets to client-specific rule set URLs', () => {
    expect(buildQuixoticRuleSetUrl('ai', 'mihomo')).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/ai.list'
    )
    expect(buildQuixoticRuleSetUrl('ai', 'singbox')).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/singbox/version5/ai.srs'
    )
    expect(buildQuixoticRuleSetUrl('ai', 'egern')).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/egern/ai.yaml'
    )
  })

  it('keeps remote rule set formats scoped to compatible exporters', () => {
    expect(isRuleSetFormatCompatible('mihomo', 'stash')).toBe(true)
    expect(isRuleSetFormatCompatible('singbox', 'mihomo')).toBe(false)
    expect(isRuleSetFormatCompatible('loon', 'surge')).toBe(true)
    expect(isRuleSetFormatCompatible('nodes_raw', 'text')).toBe(false)
  })

  it('describes unsupported exporters without remote rule set support', () => {
    expect(describeCompatibleRuleSetFormats('nodes_base64')).toBe('不支持远程规则集')
  })
})
