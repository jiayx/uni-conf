import { describe, expect, it } from 'vitest'
import { maskSubscriptionTokenUrl, maskSubscriptionUrl } from './source-url-privacy'

describe('subscription URL privacy', () => {
  it('keeps credentials, paths, and query strings out of the default summary', () => {
    expect(maskSubscriptionUrl('https://user:secret@example.com/private/sub?token=secret')).toBe(
      'https://example.com/••••?••••'
    )
    expect(maskSubscriptionUrl('not a URL')).toBe('••••••••')
  })

  it('keeps the target filename visible while masking a public export token', () => {
    expect(maskSubscriptionTokenUrl('https://config.example.com/sub/secret-token/singbox.json')).toBe(
      'https://config.example.com/sub/••••••••/singbox.json'
    )
  })
})
