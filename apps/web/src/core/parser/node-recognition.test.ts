import { describe, expect, it } from 'vitest'
import { detectFormat, parseSubscriptionContent } from './auto-detect.parser'
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

  it('detects and parses AnyTLS URI subscriptions from raw links', () => {
    const content = 'anytls://secret@hk.example.com:443?security=tls&sni=hk.example.com&alpn=h2,http/1.1&fp=chrome#%F0%9F%87%AD%F0%9F%87%B0%20HK%20AnyTLS%2001'

    expect(detectFormat(content)).toBe('base64')
    expect(parseSubscriptionContent(content, 'source-1')).toEqual([
      expect.objectContaining({
        name: '🇭🇰 HK AnyTLS 01',
        protocol: 'anytls',
        server: 'hk.example.com',
        port: 443,
        countryCode: 'HK',
        rawConfig: expect.objectContaining({
          password: 'secret',
          tls: true,
          sni: 'hk.example.com',
          alpn: 'h2,http/1.1',
          fp: 'chrome',
        }),
        parsedConfig: expect.objectContaining({
          protocol: 'anytls',
          password: 'secret',
          tls: true,
          sni: 'hk.example.com',
          extra: expect.objectContaining({
            clientFingerprint: 'chrome',
          }),
        }),
      }),
    ])
  })

  it('normalizes VLESS Reality URI aliases from the shared parser path', () => {
    const node = parseProxyLink(
      'vless://12345678-1234-1234-1234-123456789012@us.example.com:443?security=reality&sni=example.com&pbk=public-key&sid=abcd#US%20Reality',
      'source-1'
    )

    expect(node?.parsedConfig).toMatchObject({
      protocol: 'vless',
      uuid: '12345678-1234-1234-1234-123456789012',
      tls: true,
      sni: 'example.com',
      extra: {
        publicKey: 'public-key',
        shortId: 'abcd',
      },
    })
  })

  it('detects base64 subscriptions that contain AnyTLS URI links', () => {
    const encoded = btoa('anytls://secret@de.example.com:443?security=tls&sni=de.example.com#%F0%9F%87%A9%F0%9F%87%AA%20DE%20AnyTLS%2001')

    expect(detectFormat(encoded)).toBe('base64')
    expect(parseSubscriptionContent(encoded, 'source-1')).toEqual([
      expect.objectContaining({
        name: '🇩🇪 DE AnyTLS 01',
        protocol: 'anytls',
        countryCode: 'DE',
      }),
    ])
  })

  it('detects mainstream URI schemes from the shared protocol registry without treating subscription URLs as node content', () => {
    expect(detectFormat('shadowtls://secret@sg.example.com:443?sni=sg.example.com#SG%20ShadowTLS')).toBe('base64')
    expect(detectFormat('naive+https://user:pass@jp.example.com:443#JP%20Naive')).toBe('base64')
    expect(detectFormat('https://airport.example.com/sub?token=abc')).toBe('unknown')
  })

  it('detects structured config formats and client config headers', () => {
    expect(detectFormat(JSON.stringify({ outbounds: [] }))).toBe('singbox')
    expect(detectFormat(JSON.stringify({ endpoints: [] }))).toBe('singbox')
    expect(detectFormat('{"outbounds":')).toBe('unknown')
    expect(detectFormat('proxies:\n  - name: HK\n    type: trojan\n    server: hk.example.com\n    port: 443\n    password: p')).toBe('clash')
    expect(detectFormat('proxies: [')).toBe('unknown')
    expect(detectFormat('[General]\nloglevel = notify\n[Proxy]\nHK = trojan, hk.example.com, 443, password=p')).toBe('surge')
    expect(detectFormat('[General]\n[Proxy Group]\nAuto = select, HK')).toBe('loon')
    expect(detectFormat('not a subscription')).toBe('unknown')
  })

  it('parses sing-box 1.13 WireGuard endpoints with the shared normalizer', () => {
    const nodes = parseSingboxConfig(JSON.stringify({
      endpoints: [{
        type: 'wireguard',
        tag: 'US WireGuard',
        address: ['172.16.0.2/32'],
        private_key: 'private-key',
        peers: [{
          address: 'wg.example.com',
          port: 51820,
          public_key: 'peer-key',
          pre_shared_key: 'psk',
          allowed_ips: ['0.0.0.0/0', '::/0'],
        }, {
          address: 'backup-wg.example.com',
          port: 51821,
          public_key: 'backup-peer-key',
          allowed_ips: ['10.0.0.0/8'],
        }],
      }],
    }), 'source-1')

    expect(nodes).toEqual([
      expect.objectContaining({
        name: 'US WireGuard',
        protocol: 'wireguard',
        server: 'wg.example.com',
        port: 51820,
        parsedConfig: expect.objectContaining({
          extra: expect.objectContaining({
            privateKey: 'private-key',
            publicKey: 'peer-key',
            presharedKey: 'psk',
            address: ['172.16.0.2/32'],
          }),
        }),
        rawConfig: expect.objectContaining({
          peers: [
            expect.objectContaining({ address: 'wg.example.com' }),
            expect.objectContaining({ address: 'backup-wg.example.com' }),
          ],
        }),
      }),
    ])
  })

  it('distinguishes plain HTTP and TLS-enabled HTTP native proxy configs', () => {
    const clashNodes = parseClashConfig(`
proxies:
  - { name: Plain HTTP, type: http, server: plain.example.com, port: 80 }
  - { name: TLS HTTP, type: http, server: tls.example.com, port: 443, tls: true }
`, 'source-1')
    const singboxNodes = parseSingboxConfig(JSON.stringify({
      outbounds: [
        { type: 'http', tag: 'Plain HTTP', server: 'plain.example.com', server_port: 80 },
        { type: 'http', tag: 'TLS HTTP', server: 'tls.example.com', server_port: 443, tls: { enabled: true } },
      ],
    }), 'source-1')

    expect(clashNodes.map(node => [node.name, node.protocol])).toEqual([
      ['Plain HTTP', 'http'],
      ['TLS HTTP', 'https'],
    ])
    expect(singboxNodes.map(node => [node.name, node.protocol])).toEqual([
      ['Plain HTTP', 'http'],
      ['TLS HTTP', 'https'],
    ])
  })

  it('parses Hysteria URI auth as TLS-enabled normalized config', () => {
    const nodes = parseSubscriptionContent('hysteria://auth-secret@tw.example.com:443?sni=tw.example.com#TW%20Hysteria', 'source-1')

    expect(nodes).toEqual([
      expect.objectContaining({
        name: 'TW Hysteria',
        protocol: 'hysteria',
        server: 'tw.example.com',
        port: 443,
        parsedConfig: expect.objectContaining({
          password: 'auth-secret',
          tls: true,
          sni: 'tw.example.com',
        }),
      }),
    ])
  })

  it('parses additional URI-style protocol edge cases', () => {
    expect(parseProxyLink('wireguard://private-key@wg.example.com?public-key=public-key&address=10.0.0.2%2F32#WG', 'source-1')).toMatchObject({
      name: 'WG',
      protocol: 'wireguard',
      server: 'wg.example.com',
      port: 51820,
      rawConfig: expect.objectContaining({
        privateKey: 'private-key',
        publicKey: 'public-key',
        address: '10.0.0.2/32',
      }),
    })
    expect(parseProxyLink('ssh://user:pass@[2001:db8::1]#SSH%20IPv6', 'source-1')).toMatchObject({
      name: 'SSH IPv6',
      protocol: 'ssh',
      server: '2001:db8::1',
      port: 22,
      rawConfig: expect.objectContaining({
        username: 'user',
        password: 'pass',
      }),
    })
    expect(parseProxyLink('naive+https://user:pass@naive.example.com#Naive', 'source-1')).toMatchObject({
      protocol: 'naive',
      port: 443,
      rawConfig: expect.objectContaining({
        username: 'user',
        password: 'pass',
        tls: true,
      }),
    })
    expect(parseProxyLink('socks://user@socks.example.com#Socks', 'source-1')).toMatchObject({
      protocol: 'socks5',
      port: 1080,
      rawConfig: expect.objectContaining({
        username: 'user',
      }),
    })
    expect(parseProxyLink('http://proxy.example.com#HTTP', 'source-1')).toMatchObject({
      protocol: 'http',
      port: 80,
      rawConfig: expect.objectContaining({
        tls: false,
      }),
    })
    expect(parseProxyLink('not-a-proxy-link', 'source-1')).toBeNull()
  })

  it('parses ShadowsocksR URI nodes from shared mainstream scheme detection', () => {
    const nodes = parseSubscriptionContent(makeSsrUri({
      server: 'hk.example.com',
      port: 443,
      method: 'aes-256-cfb',
      password: 'secret',
      protocol: 'auth_sha1_v4',
      obfs: 'tls1.2_ticket_auth',
      name: '🇭🇰 HK SSR 01',
      obfsParam: 'cdn.example.com',
      protocolParam: '32',
    }), 'source-1')

    expect(nodes).toEqual([
      expect.objectContaining({
        name: '🇭🇰 HK SSR 01',
        protocol: 'ssr',
        server: 'hk.example.com',
        port: 443,
        countryCode: 'HK',
        rawConfig: expect.objectContaining({
          method: 'aes-256-cfb',
          password: 'secret',
          protocol: 'auth_sha1_v4',
          obfs: 'tls1.2_ticket_auth',
          obfsParam: 'cdn.example.com',
          protocolParam: '32',
        }),
        parsedConfig: expect.objectContaining({
          protocol: 'ssr',
          password: 'secret',
        }),
      }),
    ])
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

function makeSsrUri(input: {
  server: string
  port: number
  method: string
  password: string
  protocol: string
  obfs: string
  name: string
  obfsParam?: string
  protocolParam?: string
}): string {
  const main = [
    input.server,
    input.port,
    input.protocol,
    input.method,
    input.obfs,
    encodeBase64Url(input.password),
  ].join(':')
  const params = new URLSearchParams({
    remarks: encodeBase64Url(input.name),
  })
  if (input.obfsParam) params.set('obfsparam', encodeBase64Url(input.obfsParam))
  if (input.protocolParam) params.set('protoparam', encodeBase64Url(input.protocolParam))
  return `ssr://${encodeBase64Url(`${main}/?${params.toString()}`)}`
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
