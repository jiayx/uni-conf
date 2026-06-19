import { describe, expect, it } from 'vitest'
import { buildQuixoticRuleSetUrl, inferQuixoticTargetGroup } from './quixotic-presets'
import { describeCompatibleRuleSetFormats, isRemoteRuleSetCompatible, isRuleSetFormatCompatible, resolveRemoteRuleSetForExport } from './compatibility'
import type { RemoteRuleSet } from '@uni-conf/types'

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

  it('treats Quixotic presets as dynamically compatible with supported exporters', () => {
    const set = {
      name: 'AI',
      url: buildQuixoticRuleSetUrl('ai', 'mihomo'),
      format: 'mihomo',
      presetSource: 'quixotic',
      presetId: 'ai',
    } as RemoteRuleSet

    expect(isRemoteRuleSetCompatible('singbox', set)).toBe(true)
    expect(resolveRemoteRuleSetForExport(set, 'singbox')?.url).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/singbox/version5/ai.srs'
    )
    expect(isRemoteRuleSetCompatible('nodes_raw', set)).toBe(false)
  })

  it('infers target groups from preset category and known direct/reject exceptions', () => {
    expect(inferQuixoticTargetGroup({ id: 'ai', name: 'AI', description: '', category: 'ai' })).toBe('AI')
    expect(inferQuixoticTargetGroup({ id: 'netflix', name: 'Netflix', description: '', category: 'streaming' })).toBe('Streaming')
    expect(inferQuixoticTargetGroup({ id: 'bilibili', name: 'Bilibili', description: '', category: 'streaming' })).toBe('DIRECT')
    expect(inferQuixoticTargetGroup({ id: 'adrules', name: 'Advertising', description: '', category: 'privacy' })).toBe('REJECT')
  })

  it('describes unsupported exporters without remote rule set support', () => {
    expect(describeCompatibleRuleSetFormats('nodes_base64')).toBe('不支持远程规则集')
  })
})
