import { describe, expect, it } from 'vitest'
import { buildPublicSubscriptionUrl, buildUniversalSubscriptionUrl } from './quick-subscriptions'

describe('subscription URLs', () => {
  it('URL-encodes the export profile name and omits blank names', () => {
    expect(buildPublicSubscriptionUrl(
      'https://conf.example.com',
      'token-1',
      'mihomo.yaml',
      'A&B 配置',
    )).toBe('https://conf.example.com/sub/token-1/mihomo.yaml?name=A%26B%20%E9%85%8D%E7%BD%AE')
    expect(buildPublicSubscriptionUrl(
      'https://conf.example.com',
      'token-1',
      'mihomo.yaml',
      ' ',
    )).toBe('https://conf.example.com/sub/token-1/mihomo.yaml')
  })
})

it('builds a full-config universal URL and an explicit nodes-only URL', () => {
  expect(buildUniversalSubscriptionUrl('https://conf.example.com/', 'token-1'))
    .toBe('https://conf.example.com/sub/token-1')
  expect(buildUniversalSubscriptionUrl('https://conf.example.com/', 'token-1', 'nodes'))
    .toBe('https://conf.example.com/sub/token-1?mode=nodes')
})
