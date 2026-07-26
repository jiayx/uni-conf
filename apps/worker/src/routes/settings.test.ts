import { describe, expect, it } from 'vitest'
import { buildSettingsUpdate, validateSettingsPatch } from './settings'

describe('settings route helpers', () => {
  it('rejects non-object, empty, and unknown settings patches', () => {
    expect(validateSettingsPatch(null)).toBe('settings patch must be a JSON object')
    expect(validateSettingsPatch([])).toBe('settings patch must be a JSON object')
    expect(validateSettingsPatch('language=en')).toBe('settings patch must be a JSON object')
    expect(validateSettingsPatch({})).toBe('settings patch must include at least one field')
    expect(validateSettingsPatch({ langauge: 'en' })).toBe('unknown settings field: langauge')
  })

  it('accepts valid settings patches', () => {
    expect(validateSettingsPatch({
      language: 'zh',
      theme: 'system',
      unmatchedTrafficPolicy: 'proxy',
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
      ruleSetConversionPolicy: 'strict',
      enableAutoRefresh: true,
      autoRefreshInterval: 1440,
      defaultExportToken: ' token-1 ',
    })).toBeNull()
    expect(validateSettingsPatch({ defaultExportToken: null })).toBeNull()
    expect(validateSettingsPatch({ routingOutletPreferences: null })).toBeNull()
    expect(validateSettingsPatch({ autoNodeGroupKeys: null })).toBeNull()
  })

  it('rejects invalid enum settings', () => {
    expect(validateSettingsPatch({ language: 'fr' as never })).toBe('invalid language')
    expect(validateSettingsPatch({ unmatchedTrafficPolicy: 'auto' as never })).toBe('invalid unmatched traffic policy')
    expect(validateSettingsPatch({ routingPolicyTemplate: 'custom' as never })).toBe('invalid routing policy template')
    expect(validateSettingsPatch({ routingOutletPreferences: [] as never })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': '' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'us-auto' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'auto:US:url-test' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'auto:country:US' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'auto:country:USA:url-test' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ routingOutletPreferences: { 'builtin-ai': 'auto:country:us:url-test' } })).toBe('invalid routing outlet preferences')
    expect(validateSettingsPatch({ dnsMode: 'system' as never })).toBe('invalid DNS mode')
    expect(validateSettingsPatch({ exportNodeNamingMode: 'random' as never })).toBe('invalid export node naming mode')
    expect(validateSettingsPatch({ autoNodeGroupTypes: ['url-test', 'random' as never] })).toBe('invalid auto node group type')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['US:url-test'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['country:usa:url-test'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupKeys: ['country:US:load-balance'] })).toBe('invalid auto node group key')
    expect(validateSettingsPatch({ autoNodeGroupsEnabled: 'true' as never })).toBe('invalid auto node groups enabled')
    expect(validateSettingsPatch({ autoNodeGroupIncludeFlag: 'true' as never })).toBe('invalid auto node group include flag')
    expect(validateSettingsPatch({ defaultExportToken: '' })).toBe('invalid default export token')
    expect(validateSettingsPatch({ defaultExportToken: 123 as never })).toBe('invalid default export token')
    expect(validateSettingsPatch({ showCompatibilityWarnings: 1 as never })).toBe('invalid compatibility warnings setting')
    expect(validateSettingsPatch({ enableAutoRefresh: 1 as never })).toBe('invalid auto refresh setting')
    expect(validateSettingsPatch({ ruleSetConversionPolicy: 'best-effort' as never })).toBe('invalid rule set conversion policy')
  })

  it('rejects invalid auto refresh intervals', () => {
    expect(validateSettingsPatch({ autoRefreshInterval: 0 })).toBe('invalid auto refresh interval')
    expect(validateSettingsPatch({ autoRefreshInterval: 1.5 })).toBe('invalid auto refresh interval')
    expect(validateSettingsPatch({ autoRefreshInterval: Number.NaN })).toBe('invalid auto refresh interval')
  })

  it('updates only fields present in an unrelated settings patch', () => {
    const language = buildSettingsUpdate({ language: 'en' }, '2026-07-24T00:00:00.000Z')
    const dns = buildSettingsUpdate({ dnsMode: 'fake-ip' }, '2026-07-24T00:00:01.000Z')

    expect(language.sql).toContain('language = ?')
    expect(language.sql).not.toContain('theme = ?')
    expect(language.sql).not.toContain('dns_mode = ?')
    expect(language.values).toEqual(['en', '2026-07-24T00:00:00.000Z'])

    expect(dns.sql).toContain('dns_mode = ?')
    expect(dns.sql).not.toContain('language = ?')
    expect(dns.values).toEqual(['fake-ip', '2026-07-24T00:00:01.000Z'])
  })

  it('updates a routing template independently from other settings', () => {
    const update = buildSettingsUpdate(
      { routingPolicyTemplate: 'router' },
      '2026-07-24T00:00:00.000Z',
    )

    expect(update.sql).toContain('routing_policy_template = ?')
    expect(update.sql).not.toContain('language = ?')
    expect(update.values).toEqual(['router', '2026-07-24T00:00:00.000Z'])
  })

  it('updates the unmatched traffic policy independently', () => {
    const update = buildSettingsUpdate(
      { unmatchedTrafficPolicy: 'direct' },
      '2026-07-24T00:00:00.000Z',
    )

    expect(update.sql).toContain('unmatched_traffic_policy = ?')
    expect(update.values).toEqual(['direct', '2026-07-24T00:00:00.000Z'])
  })

  it('updates routing and DNS together only when both are explicitly provided', () => {
    const update = buildSettingsUpdate(
      { routingPolicyTemplate: 'router', dnsMode: 'smart' },
      '2026-07-24T00:00:00.000Z',
    )

    expect(update.sql).toContain('routing_policy_template = ?')
    expect(update.sql).toContain('dns_mode = ?')
    expect(update.values).toEqual(['router', 'smart', '2026-07-24T00:00:00.000Z'])
  })

  it('serializes nullable and structured settings without carrying stale values', () => {
    const update = buildSettingsUpdate({
      routingOutletPreferences: { 'builtin-ai': 'group:AI' },
      defaultExportToken: null,
      autoNodeGroupTypes: ['select', 'fallback'],
      autoNodeGroupKeys: null,
      showCompatibilityWarnings: false,
    }, '2026-07-24T00:00:00.000Z')

    expect(update.values).toEqual([
      '{"builtin-ai":"group:AI"}',
      null,
      0,
      '["select","fallback"]',
      null,
      '2026-07-24T00:00:00.000Z',
    ])
  })
})
