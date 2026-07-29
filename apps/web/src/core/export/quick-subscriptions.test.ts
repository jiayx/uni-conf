import { describe, expect, it } from 'vitest'
import { buildPublicSubscriptionUrl, buildQuickSubscriptionLinks } from './quick-subscriptions'

describe('buildQuickSubscriptionLinks', () => {
  it('builds canonical subscription URLs for every quick export format', () => {
    const links = buildQuickSubscriptionLinks(
      'https://conf.example.com/',
      'token-1',
      true,
      'UniConf',
    )

    expect(links).toHaveLength(11)
    expect(links[0]).toEqual({
      value: 'mihomo',
      label: 'Mihomo YAML',
      url: 'https://conf.example.com/sub/token-1/mihomo.yaml?name=UniConf%20%C2%B7%20Mihomo',
    })
    expect(links.at(-1)).toEqual({
      value: 'nodes_raw',
      label: 'Node Subscription (Raw)',
      url: 'https://conf.example.com/sub/token-1/nodes-raw.txt?name=UniConf%20%C2%B7%20Node%20Subscription%20(Raw)',
    })
    expect(links.every(link => link.url.includes('?name=UniConf%20%C2%B7%20'))).toBe(true)
  })

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

  it('returns no links until the default token exists', () => {
    expect(buildQuickSubscriptionLinks('https://conf.example.com', null)).toEqual([])
    expect(buildQuickSubscriptionLinks('https://conf.example.com', '')).toEqual([])
  })

  it('returns no links while the default export profile is paused', () => {
    expect(buildQuickSubscriptionLinks('https://conf.example.com', 'token-1', false)).toEqual([])
  })
})
