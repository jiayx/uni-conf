import { describe, expect, it } from 'vitest'
import { buildQuickSubscriptionLinks } from './quick-subscriptions'

describe('buildQuickSubscriptionLinks', () => {
  it('builds canonical subscription URLs for every quick export format', () => {
    expect(buildQuickSubscriptionLinks('https://conf.example.com/', 'token-1')).toEqual([
      { value: 'mihomo', label: 'Mihomo YAML', url: 'https://conf.example.com/sub/token-1/mihomo.yaml' },
      { value: 'clash', label: 'Clash / OpenClash YAML', url: 'https://conf.example.com/sub/token-1/clash.yaml' },
      { value: 'singbox', label: 'sing-box JSON', url: 'https://conf.example.com/sub/token-1/singbox.json' },
      { value: 'loon', label: 'Loon CONF', url: 'https://conf.example.com/sub/token-1/loon.conf' },
      { value: 'surge', label: 'Surge CONF', url: 'https://conf.example.com/sub/token-1/surge.conf' },
      { value: 'shadowrocket', label: 'Shadowrocket CONF', url: 'https://conf.example.com/sub/token-1/shadowrocket.conf' },
      { value: 'quantumultx', label: 'Quantumult X CONF', url: 'https://conf.example.com/sub/token-1/quantumultx.conf' },
      { value: 'stash', label: 'Stash YAML', url: 'https://conf.example.com/sub/token-1/stash.yaml' },
      { value: 'egern', label: 'Egern YAML', url: 'https://conf.example.com/sub/token-1/egern.yaml' },
      { value: 'nodes_base64', label: 'Node Subscription (Base64)', url: 'https://conf.example.com/sub/token-1/nodes.txt' },
      { value: 'nodes_raw', label: 'Node Subscription (Raw)', url: 'https://conf.example.com/sub/token-1/nodes-raw.txt' },
    ])
  })

  it('returns no links until the default token exists', () => {
    expect(buildQuickSubscriptionLinks('https://conf.example.com', null)).toEqual([])
    expect(buildQuickSubscriptionLinks('https://conf.example.com', '')).toEqual([])
  })
})
