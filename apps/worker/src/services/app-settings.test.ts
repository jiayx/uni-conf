import { describe, expect, it } from 'vitest'
import {
  normalizeAutoNodeGroupTypes,
  normalizeBooleanDefault,
  normalizeDnsMode,
  normalizeExportNodeNamingMode,
  normalizeOptionalStringList,
  normalizePositiveInteger,
  normalizeRoutingPolicyTemplate,
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
    expect(normalizeDnsMode('unknown')).toBe('smart')
    expect(normalizeRoutingPolicyTemplate('unknown')).toBe('common')
    expect(normalizeRoutingPolicyTemplate('router')).toBe('router')
    expect(normalizeExportNodeNamingMode('unknown')).toBe('smart')
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
  })
})
