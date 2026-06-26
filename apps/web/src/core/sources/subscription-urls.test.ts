import { describe, expect, it } from 'vitest'
import { parseSubscriptionUrls } from './subscription-urls'

describe('parseSubscriptionUrls', () => {
  it('extracts unique http subscription URLs from pasted text', () => {
    expect(parseSubscriptionUrls(`
      https://example.com/a
      http://example.com/b, https://example.com/a
      ftp://example.com/ignored not-a-url
      https://example.com/c?token=abc
    `)).toEqual([
      'https://example.com/a',
      'http://example.com/b',
      'https://example.com/c?token=abc',
    ])
  })
})
