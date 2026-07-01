import { describe, expect, it } from 'vitest'
import { parseClashConfig } from './clash.parser'
import { parseProxyLink, parseProxyLinks } from './proxy-link.parser'
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

  it('filters subscription information pseudo nodes in URI lists', () => {
    const nodes = parseProxyLinks([
      'trojan://password@info.example.com:443#%E5%AE%98%E7%BD%91%EF%BC%9Ahttps%3A%2F%2Fexample.com',
      'trojan://password@hk.example.com:443#%F0%9F%87%AD%F0%9F%87%B0%20HK%2001',
    ].join('\n'), 'source-1')

    expect(nodes.map(node => node.name)).toEqual(['🇭🇰 HK 01'])
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

  it('filters subscription information pseudo nodes in Clash configs', () => {
    const nodes = parseClashConfig(`
proxies:
  - name: "套餐到期：2026-12-31"
    type: ss
    server: info.example.com
    port: 8388
    cipher: aes-256-gcm
    password: password
  - name: "🇭🇰 HK 01"
    type: ss
    server: hk.example.com
    port: 8388
    cipher: aes-256-gcm
    password: password
`, 'source-1')

    expect(nodes.map(node => node.name)).toEqual(['🇭🇰 HK 01'])
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

  it('filters subscription information pseudo nodes in sing-box configs', () => {
    const nodes = parseSingboxConfig(JSON.stringify({
      outbounds: [
        {
          type: 'trojan',
          tag: 'Traffic Remaining 100GB',
          server: 'info.example.com',
          server_port: 443,
          password: 'password',
        },
        {
          type: 'trojan',
          tag: '🇺🇸 US 01',
          server: 'us.example.com',
          server_port: 443,
          password: 'password',
        },
      ],
    }), 'source-1')

    expect(nodes.map(node => node.name)).toEqual(['🇺🇸 US 01'])
  })
})
