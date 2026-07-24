import { describe, expect, it } from 'vitest'
import { buildQuixoticRuleSetUrl, inferQuixoticRuleSetSourceFromUrl, inferQuixoticTargetGroup, resolveQuixoticRuleSetBehavior } from './quixotic-presets'
import { describeCompatibleRuleSetFormats, getRemoteRuleSetCompatibilityMode, isRemoteRuleSetCompatible, isRuleSetFormatCompatible, resolveRemoteRuleSetForExport } from './compatibility'
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
    expect(buildQuixoticRuleSetUrl('fake-ip-filter', 'mihomo')).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/master/custom/domain/fake-ip-filter.list'
    )
    expect(buildQuixoticRuleSetUrl('fake-ip-filter', 'singbox')).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/master/custom/domain/fake-ip-filter.list'
    )
    expect(resolveQuixoticRuleSetBehavior('fake-ip-filter')).toBe('domain')
  })

  it('recognizes only strict target-specific Quixotic rule-set URLs', () => {
    expect(inferQuixoticRuleSetSourceFromUrl(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list?download=1'
    )).toEqual({ id: 'games', format: 'mihomo' })
    expect(inferQuixoticRuleSetSourceFromUrl(
      'https://raw.githubusercontent.com/QuixoticHeart/rule-set/ruleset/singbox/version5/games.srs'
    )).toEqual({ id: 'games', format: 'singbox' })
    expect(inferQuixoticRuleSetSourceFromUrl(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/egern/games.yaml'
    )).toEqual({ id: 'games', format: 'egern' })
    expect(inferQuixoticRuleSetSourceFromUrl('https://evil.example/QuixoticHeart/rule-set/meta/games.list')).toBeNull()
    expect(inferQuixoticRuleSetSourceFromUrl(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/master/custom/domain/fake-ip-filter.list'
    )).toBeNull()
    expect(inferQuixoticRuleSetSourceFromUrl('http://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list')).toBeNull()
  })

  it('keeps remote rule set formats scoped to compatible exporters', () => {
    expect(isRuleSetFormatCompatible('mihomo', 'stash')).toBe(true)
    expect(isRuleSetFormatCompatible('singbox', 'mihomo')).toBe(false)
    expect(isRuleSetFormatCompatible('loon', 'surge')).toBe(true)
    expect(isRuleSetFormatCompatible('nodes_raw', 'text')).toBe(false)
  })

  it('marks exact cross-client rewrites as converted instead of directly compatible', () => {
    const singboxSet = { format: 'singbox', url: 'https://rules.example/source.json', sourceOverrides: {} } as RemoteRuleSet
    const quantumultXSet = { format: 'quantumultx', url: 'https://rules.example/qx.list', sourceOverrides: {} } as RemoteRuleSet

    expect(getRemoteRuleSetCompatibilityMode('quantumultx', singboxSet)).toBe('converted')
    expect(getRemoteRuleSetCompatibilityMode('singbox', quantumultXSet)).toBe('converted')
    expect(getRemoteRuleSetCompatibilityMode('egern', singboxSet)).toBe('converted')
  })

  it('prefers a custom target-native source over automatic conversion', () => {
    const set = {
      format: 'clash',
      url: 'https://rules.example/default.list',
      sourceOverrides: { egern: 'https://rules.example/native-egern.yaml' },
    } as RemoteRuleSet

    expect(getRemoteRuleSetCompatibilityMode('egern', set)).toBe('direct')
    expect(resolveRemoteRuleSetForExport(set, 'egern')).toEqual({
      url: 'https://rules.example/native-egern.yaml',
      format: 'egern',
    })
    expect(getRemoteRuleSetCompatibilityMode('singbox', set)).toBe('converted')
  })

  it('treats Quixotic presets as dynamically compatible with supported exporters', () => {
    const set = {
      name: 'AI',
      url: buildQuixoticRuleSetUrl('ai', 'mihomo'),
      format: 'mihomo',
      behavior: 'classical',
      presetSource: 'quixotic',
      presetId: 'ai',
      sortOrder: 40,
    } as RemoteRuleSet

    expect(isRemoteRuleSetCompatible('singbox', set)).toBe(true)
    expect(resolveRemoteRuleSetForExport(set, 'singbox')?.url).toBe(
      'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/singbox/version5/ai.srs'
    )
    expect(isRemoteRuleSetCompatible('nodes_raw', set)).toBe(false)

    const fakeIpFilterSet = {
      ...set,
      name: 'Fake IP Filter',
      url: buildQuixoticRuleSetUrl('fake-ip-filter', 'mihomo'),
      presetId: 'fake-ip-filter',
    } as RemoteRuleSet
    expect(resolveRemoteRuleSetForExport(fakeIpFilterSet, 'mihomo')).toMatchObject({
      url: 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/master/custom/domain/fake-ip-filter.list',
      format: 'text',
    })
    expect(isRemoteRuleSetCompatible('mihomo', fakeIpFilterSet)).toBe(true)
    expect(isRemoteRuleSetCompatible('singbox', fakeIpFilterSet)).toBe(true)
    expect(getRemoteRuleSetCompatibilityMode('singbox', fakeIpFilterSet)).toBe('converted')
  })

  it('infers target groups from preset category and known direct/reject exceptions', () => {
    expect(inferQuixoticTargetGroup({ id: 'ai', name: 'AI', description: '', category: 'ai' })).toBe('AI')
    expect(inferQuixoticTargetGroup({ id: 'netflix', name: 'Netflix', description: '', category: 'streaming' })).toBe('Streaming')
    expect(inferQuixoticTargetGroup({ id: 'telegram', name: 'Telegram', description: '', category: 'social' })).toBe('Telegram')
    expect(inferQuixoticTargetGroup({ id: 'bilibili', name: 'Bilibili', description: '', category: 'streaming' })).toBe('DIRECT')
    expect(inferQuixoticTargetGroup({ id: 'adrules', name: 'Advertising', description: '', category: 'privacy' })).toBe('REJECT')
  })

  it('describes unsupported exporters without remote rule set support', () => {
    expect(describeCompatibleRuleSetFormats('nodes_base64', key => {
      if (key === 'remoteRuleSets.unsupported_formats') return '不支持远程规则集'
      return key
    })).toBe('不支持远程规则集')
  })
})
