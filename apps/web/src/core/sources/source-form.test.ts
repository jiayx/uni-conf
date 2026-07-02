import { describe, expect, it } from 'vitest'
import { buildCreateSourcePayload, resolveCreateSourceUserAgent, resolveUpdateSourceUserAgent } from './source-form'

describe('source form helpers', () => {
  it('builds the minimal default create payload from a subscription URL', () => {
    expect(buildCreateSourcePayload({
      url: 'https://example.com/sub',
      format: 'auto',
      updateInterval: 0,
      refreshAfterCreate: true,
    })).toEqual({
      url: 'https://example.com/sub',
    })
  })

  it('includes only user-changed advanced create fields', () => {
    expect(buildCreateSourcePayload({
      name: ' Airport ',
      url: 'https://example.com/sub',
      format: 'mihomo',
      updateInterval: 60,
      userAgent: 'Clash.Meta',
      notes: ' note ',
      refreshAfterCreate: false,
    })).toEqual({
      name: 'Airport',
      url: 'https://example.com/sub',
      format: 'mihomo',
      updateInterval: 60,
      userAgent: 'Clash.Meta',
      notes: 'note',
      refreshAfterCreate: false,
    })
  })

  it('omits default User-Agent on source creation', () => {
    expect(resolveCreateSourceUserAgent('', '')).toBeUndefined()
  })

  it('sends an empty User-Agent on update so the backend clears an existing value', () => {
    expect(resolveUpdateSourceUserAgent('', '')).toBe('')
  })

  it('normalizes custom User-Agent values', () => {
    expect(resolveCreateSourceUserAgent('custom', '  Surge/5.9.0  ')).toBe('Surge/5.9.0')
    expect(resolveUpdateSourceUserAgent('custom', '  Surge/5.9.0  ')).toBe('Surge/5.9.0')
    expect(resolveCreateSourceUserAgent('custom', '   ')).toBeUndefined()
    expect(resolveUpdateSourceUserAgent('custom', '   ')).toBe('')
  })
})
