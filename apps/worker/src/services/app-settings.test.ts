import { describe, expect, it } from 'vitest'
import {
  normalizeAutoNodeGroupTypes,
  normalizeBooleanDefault,
  normalizeExportNodeNamingMode,
  normalizeLanguage,
  normalizeOptionalString,
  normalizeOptionalStringList,
  normalizePositiveInteger,
  normalizeRoutingPolicyScenarios,
  normalizeRuleSetConversionPolicy,
  normalizeTheme,
  normalizeUnmatchedTrafficPolicy,
} from './app-settings'

describe('app settings normalization', () => {
  it('defaults nullable boolean settings to the product defaults', () => {
    expect(normalizeBooleanDefault(null, true)).toBe(true)
    expect(normalizeBooleanDefault(undefined, true)).toBe(true)
    expect(normalizeBooleanDefault(0, true)).toBe(false)
    expect(normalizeBooleanDefault('false', true)).toBe(false)
    expect(normalizeBooleanDefault('yes', false)).toBe(true)
  })

  it('defaults invalid intervals and modes', () => {
    expect(normalizePositiveInteger(null, 1440)).toBe(1440)
    expect(normalizePositiveInteger(0, 1440)).toBe(1440)
    expect(normalizePositiveInteger('30', 1440)).toBe(30)
    expect(normalizeLanguage('fr')).toBe('zh')
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeTheme('sepia')).toBe('system')
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeUnmatchedTrafficPolicy('unknown')).toBe('proxy')
    expect(normalizeUnmatchedTrafficPolicy('direct')).toBe('direct')
    expect(normalizeRoutingPolicyScenarios('unknown')).toEqual(['ai-development', 'streaming', 'diagnostics'])
    expect(normalizeRoutingPolicyScenarios('[]')).toEqual([])
    expect(normalizeRoutingPolicyScenarios('["diagnostics","streaming","diagnostics"]')).toEqual(['streaming', 'diagnostics'])
    expect(normalizeExportNodeNamingMode('unknown')).toBe('smart')
    expect(normalizeRuleSetConversionPolicy('strict')).toBe('strict')
    expect(normalizeRuleSetConversionPolicy('unknown')).toBe('compatible')
  })

  it('normalizes auto node group settings', () => {
    expect(normalizeAutoNodeGroupTypes(null)).toEqual(['url-test'])
    expect(normalizeAutoNodeGroupTypes('not-json')).toEqual(['url-test'])
    expect(normalizeAutoNodeGroupTypes('["invalid"]')).toEqual(['url-test'])
    expect(normalizeAutoNodeGroupTypes('[]')).toEqual([])
    expect(normalizeAutoNodeGroupTypes('["fallback","url-test","invalid","select","fallback"]')).toEqual(['select', 'url-test', 'fallback'])
    expect(normalizeOptionalStringList(null)).toBeUndefined()
    expect(normalizeOptionalStringList('[]')).toEqual([])
    expect(normalizeOptionalStringList('["country:US:url-test",""]')).toEqual(['country:US:url-test'])
    expect(normalizeOptionalString(null)).toBeUndefined()
    expect(normalizeOptionalString(123)).toBeUndefined()
    expect(normalizeOptionalString('   ')).toBeUndefined()
    expect(normalizeOptionalString(' token-1 ')).toBe('token-1')
  })
})
