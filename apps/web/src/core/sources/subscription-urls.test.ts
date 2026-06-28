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

  it('supports the dashboard multi-url paste separators used by the zero-setup entry', () => {
    expect(parseSubscriptionUrls(' https://a.example/sub，https://b.example/sub  https://a.example/sub\nhttps://c.example/sub,invalid ')).toEqual([
      'https://a.example/sub',
      'https://b.example/sub',
      'https://c.example/sub',
    ])
  })

  it('extracts urls from labelled paste text and trims sentence punctuation', () => {
    expect(parseSubscriptionUrls('订阅一：https://a.example/sub；备用(https://b.example/sub)，说明 https://c.example/sub。')).toEqual([
      'https://a.example/sub',
      'https://b.example/sub',
      'https://c.example/sub',
    ])
  })
})
