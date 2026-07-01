import { describe, expect, it } from 'vitest'
import { resolveCreateSourceUserAgent, resolveUpdateSourceUserAgent } from './source-form'

describe('source form helpers', () => {
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
