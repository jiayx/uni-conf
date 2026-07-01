import { describe, expect, it } from 'vitest'
import { parseClashConfig } from './clash.parser'
import { parseProxyLink } from './proxy-link.parser'
import { parseSingboxConfig } from './singbox.parser'

describe('frontend parser node recognition', () => {
  it('attaches shared recognition tags to URI nodes', () => {
    const node = parseProxyLink(
      'trojan://password@hk.example.com:443#%F0%9F%87%AD%F0%9F%87%B0%20Netflix%20HK%202x',
      'source-1'
    )

    expect(node).toMatchObject({
      name: '🇭🇰 Netflix HK 2x',
      countryCode: 'HK',
      tags: ['multiplier:2x', 'high-multiplier', 'streaming'],
    })
  })

  it('attaches shared recognition tags to Clash nodes', () => {
    const [node] = parseClashConfig(`
proxies:
  - name: "🇺🇸 US Residential Native"
    type: ss
    server: us.example.com
    port: 8388
    cipher: aes-256-gcm
    password: password
`, 'source-1')

    expect(node).toMatchObject({
      countryCode: 'US',
      tags: ['residential', 'native-ip'],
    })
  })

  it('attaches shared recognition tags to sing-box nodes', () => {
    const [node] = parseSingboxConfig(JSON.stringify({
      outbounds: [{
        type: 'hysteria2',
        tag: 'JP Streaming x1.5',
        server: 'jp.example.com',
        server_port: 443,
        password: 'password',
      }],
    }), 'source-1')

    expect(node).toMatchObject({
      countryCode: 'JP',
      tags: ['multiplier:1.5x', 'high-multiplier', 'streaming'],
    })
  })
})
