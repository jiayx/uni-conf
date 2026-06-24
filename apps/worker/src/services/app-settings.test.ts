import { describe, expect, it } from 'vitest'
import { normalizeBooleanDefault, normalizeDnsMode, normalizeExportNodeNamingMode, normalizePositiveInteger } from './app-settings'

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
    expect(normalizeExportNodeNamingMode('unknown')).toBe('smart')
  })
})
