import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { generateEgern, generateQuantumultX, generateShadowrocket, generateSurge } from './client-configs'
import { generateLoon } from './loon'
import { generateNodeSubscriptionRaw } from './node-subscription'

const anytlsRow: Record<string, unknown> = {
  id: 'node-anytls',
  name: 'HK AnyTLS',
  protocol: 'anytls',
  server: 'hk.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'anytls',
    server: 'hk.example.com',
    port: 443,
    password: 'secret',
    sni: 'hk.example.com',
    skipCertVerify: false,
    extra: {
      'client-fingerprint': 'chrome',
      alpn: ['h2', 'http/1.1'],
      udp: true,
    },
  }),
}

const otherRow: Record<string, unknown> = {
  ...anytlsRow,
  id: 'node-other',
  name: 'US AnyTLS',
  server: 'us.example.com',
  parsed_config: JSON.stringify({
    protocol: 'anytls',
    server: 'us.example.com',
    port: 443,
    password: 'secret',
    sni: 'us.example.com',
    skipCertVerify: false,
    extra: {},
  }),
}

const fingerprintRow: Record<string, unknown> = {
  ...anytlsRow,
  id: 'node-fingerprint',
  name: 'HK AnyTLS FP',
  parsed_config: JSON.stringify({
    protocol: 'anytls',
    server: 'hk.example.com',
    port: 443,
    password: 'secret',
    sni: 'hk.example.com',
    skipCertVerify: false,
    extra: {
      fingerprint: 'safari',
      udp: true,
    },
  }),
}

const ssrRow: Record<string, unknown> = {
  id: 'node-ssr',
  name: '🇭🇰 HK SSR 01',
  protocol: 'ssr',
  server: 'hk.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'ssr',
    server: 'hk.example.com',
    port: 443,
    password: 'secret',
    extra: {
      method: 'aes-256-cfb',
      protocol: 'auth_sha1_v4',
      obfs: 'tls1.2_ticket_auth',
      obfsParam: 'cdn.example.com',
      protocolParam: '32',
      group: 'Airport',
    },
  }),
}

const hysteriaRow: Record<string, unknown> = {
  id: 'node-hysteria',
  name: 'SG Hysteria',
  protocol: 'hysteria',
  server: 'sg.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'hysteria',
    server: 'sg.example.com',
    port: 443,
    password: 'auth-secret',
    tls: true,
    sni: 'sg.example.com',
    skipCertVerify: true,
    extra: {
      protocol: 'udp',
      upMbps: 80,
      downMbps: 120,
    },
  }),
}

const wireguardRow: Record<string, unknown> = {
  id: 'node-wireguard',
  name: 'US WireGuard',
  protocol: 'wireguard',
  server: 'wg.example.com',
  port: 51820,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'wireguard',
    server: 'wg.example.com',
    port: 51820,
    extra: {
      privateKey: 'private-key',
      publicKey: 'public-key',
      presharedKey: 'psk',
      ip: ['10.0.0.2/32', 'fd00::2/128'],
    },
  }),
}

const httpsRow: Record<string, unknown> = {
  id: 'node-https',
  name: 'HTTPS Proxy',
  protocol: 'https',
  server: 'https.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'https',
    server: 'https.example.com',
    port: 443,
    password: 'pass',
    extra: {
      username: 'user',
    },
  }),
}

const socksRow: Record<string, unknown> = {
  id: 'node-socks',
  name: 'SOCKS Proxy',
  protocol: 'socks5',
  server: 'socks.example.com',
  port: 1080,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'socks5',
    server: 'socks.example.com',
    port: 1080,
    password: 'socks-pass',
    extra: {
      username: 'socks-user',
      udp: true,
    },
  }),
}

const vmessWsRow: Record<string, unknown> = {
  id: 'node-vmess-ws',
  name: 'VMess WS',
  protocol: 'vmess',
  server: 'vmess.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'vmess',
    server: 'vmess.example.com',
    port: 443,
    uuid: '00000000-0000-4000-8000-000000000001',
    network: 'ws',
    wsPath: '/socket',
    wsHeaders: { Host: 'cdn.example.com' },
    tls: true,
    sni: 'tls.example.com',
    skipCertVerify: true,
    extra: {},
  }),
}

const hysteria2Row: Record<string, unknown> = {
  id: 'node-hysteria2',
  name: 'Hysteria 2',
  protocol: 'hysteria2',
  server: 'hy2.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'hysteria2',
    server: 'hy2.example.com',
    port: 443,
    password: 'hy2-secret',
    sni: 'hy2.example.com',
    skipCertVerify: true,
    extra: {
      downMbps: 200,
      obfs: 'salamander',
      obfsPassword: 'obfs-secret',
    },
  }),
}

const shadowTlsRow: Record<string, unknown> = {
  id: 'node-shadowtls',
  name: 'ShadowTLS Proxy',
  protocol: 'shadowtls',
  server: 'shadowtls.example.com',
  port: 443,
  enabled: 1,
  parsed_config: JSON.stringify({
    protocol: 'shadowtls',
    server: 'shadowtls.example.com',
    port: 443,
    password: 'secret',
    tls: true,
    sni: 'gateway.example.com',
    extra: {},
  }),
}

const autoGroupRow: Record<string, unknown> = {
  id: 'group-auto',
  name: 'HK Auto',
  type: 'url-test',
  collection_ids: '["collection-auto"]',
  group_ids: '[]',
  builtins: '[]',
  enabled: 1,
  test_url: 'http://www.gstatic.com/generate_204',
  interval: 300,
}

const collectionNodeNames = {
  'collection-auto': ['HK AnyTLS'],
}

describe('AnyTLS preview generators', () => {
  it('exports AnyTLS node subscription URIs', () => {
    const content = generateNodeSubscriptionRaw([anytlsRow])

    expect(content).toContain('anytls://secret@hk.example.com:443')
    expect(content).toContain('sni=hk.example.com')
    expect(content).toContain('fp=chrome')
  })

  it('exports AnyTLS fingerprint aliases in node subscription URIs', () => {
    const content = generateNodeSubscriptionRaw([fingerprintRow])

    expect(content).toContain('anytls://secret@hk.example.com:443')
    expect(content).toContain('fp=safari')
  })

  it('exports ShadowsocksR node subscription URIs', () => {
    const content = generateNodeSubscriptionRaw([ssrRow])

    expect(content).toMatch(/^ssr:\/\//)
    expect(decodeSsrUri(content)).toMatchObject({
      server: 'hk.example.com',
      port: '443',
      protocol: 'auth_sha1_v4',
      method: 'aes-256-cfb',
      obfs: 'tls1.2_ticket_auth',
      password: 'secret',
      remarks: '🇭🇰 HK SSR 01',
      obfsParam: 'cdn.example.com',
      protocolParam: '32',
      group: 'Airport',
    })
  })

  it('exports Hysteria node subscription URIs with parsed auth strings', () => {
    const content = generateNodeSubscriptionRaw([hysteriaRow])

    expect(content).toContain('hysteria://auth-secret@sg.example.com:443')
    expect(content).toContain('security=tls')
    expect(content).toContain('sni=sg.example.com')
    expect(content).toContain('allowInsecure=1')
    expect(content).toContain('#SG%20Hysteria')
  })

  it('exports additional mainstream protocols in node subscription URIs', () => {
    const content = generateNodeSubscriptionRaw([wireguardRow, httpsRow, shadowTlsRow])

    expect(content).toContain('wireguard://private-key@wg.example.com:51820')
    expect(content).toContain('public-key=public-key')
    expect(content).toContain('address=10.0.0.2%2F32%2Cfd00%3A%3A2%2F128')
    expect(content).toContain('https://user:pass@https.example.com:443#HTTPS%20Proxy')
    expect(content).toContain('shadowtls://secret@shadowtls.example.com:443')
    expect(content).toContain('sni=gateway.example.com')
  })

  it('does not emit undocumented AnyTLS syntax in Loon profiles', () => {
    const content = generateLoon([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).not.toContain('HK AnyTLS =')
    expect(content).not.toContain('HK Auto = url-latency-benchmark, HK AnyTLS')
  })

  it('exports Hysteria 2 with native Loon positional fields', () => {
    const content = generateLoon(
      [hysteria2Row],
      [autoGroupRow],
      [],
      [],
      { 'collection-auto': ['Hysteria 2'] }
    )

    expect(content).toContain(
      'Hysteria 2 = Hysteria2,hy2.example.com,443,"hy2-secret",tls-name=hy2.example.com,skip-cert-verify=true'
    )
    expect(content).toContain('HK Auto = url-latency-benchmark, Hysteria 2')
  })

  it('exports AnyTLS nodes in Surge preview', () => {
    const content = generateSurge([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('uses native Surge authentication and HTTPS proxy types', () => {
    const content = generateSurge([httpsRow, socksRow], [], [], [])

    expect(content).toContain('HTTPS Proxy = https, https.example.com, 443, user, pass')
    expect(content).not.toMatch(/HTTPS Proxy = http,/)
    expect(content).not.toContain('tls=true')
    expect(content).toContain('SOCKS Proxy = socks5, socks.example.com, 1080, socks-user, socks-pass, udp-relay=true')
  })

  it('exports Surge VMess WebSocket and Hysteria 2 fields natively', () => {
    const content = generateSurge([vmessWsRow, hysteria2Row], [], [], [])

    expect(content).toContain(
      'VMess WS = vmess, vmess.example.com, 443, username=00000000-0000-4000-8000-000000000001, ws=true, ws-path=/socket, ws-headers=Host:cdn.example.com, tls=true, sni=tls.example.com, skip-cert-verify=true'
    )
    expect(content).toContain(
      'Hysteria 2 = hysteria2, hy2.example.com, 443, password=hy2-secret, sni=hy2.example.com, skip-cert-verify=true, download-bandwidth=200, salamander-password=obfs-secret'
    )
  })

  it('exports AnyTLS nodes in Shadowrocket preview', () => {
    const content = generateShadowrocket([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Quantumult X preview', () => {
    const content = generateQuantumultX([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('anytls=hk.example.com:443, password=secret, over-tls=true')
    expect(content).toContain('tls-host=hk.example.com')
    expect(content).toContain('tag=HK AnyTLS')
    expect(content).not.toContain('anytls://')
    expect(content).toContain('url-latency-benchmark=HK Auto, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Egern preview', () => {
    const content = generateEgern([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)
    const config = yaml.load(content) as {
      proxies: Array<Record<string, unknown>>;
      policy_groups: Array<{ auto_test?: { name: string; policies: string[] } }>;
    }

    expect(config.proxies).toContainEqual({
      anytls: expect.objectContaining({
        name: 'HK AnyTLS',
        server: 'hk.example.com',
      }),
    })
    expect(config.policy_groups.find((group) => group.auto_test?.name === 'HK Auto')?.auto_test?.policies)
      .toEqual(['HK AnyTLS'])
  })

  it('does not add unrelated exported nodes to scoped groups', () => {
    const rows = [anytlsRow, otherRow]
    const loonGroup = { ...autoGroupRow, collection_ids: '["collection-loon"]' }
    const loon = generateLoon(
      [httpsRow, socksRow],
      [loonGroup],
      [],
      [],
      { 'collection-loon': ['HTTPS Proxy'] }
    )
    const surge = generateSurge(rows, [autoGroupRow], [], [], collectionNodeNames)
    const shadowrocket = generateShadowrocket(rows, [autoGroupRow], [], [], collectionNodeNames)
    const quantumultx = generateQuantumultX(rows, [autoGroupRow], [], [], collectionNodeNames)
    const egern = yaml.load(generateEgern(rows, [autoGroupRow], [], [], collectionNodeNames)) as {
      policy_groups: Array<{ auto_test?: { name: string; policies: string[] } }>;
    }

    expect(loon).toContain('HK Auto = url-latency-benchmark, HTTPS Proxy')
    expect(loon).not.toContain('HK Auto = url-latency-benchmark, HTTPS Proxy, SOCKS Proxy')
    expect(loon).not.toContain('SOCKS Proxy =')
    expect(surge).toContain('HK Auto = url-test, HK AnyTLS')
    expect(surge).not.toContain('HK Auto = url-test, HK AnyTLS, US AnyTLS')
    expect(shadowrocket).toContain('HK Auto = url-test, HK AnyTLS')
    expect(shadowrocket).not.toContain('HK Auto = url-test, HK AnyTLS, US AnyTLS')
    expect(quantumultx).toContain('url-latency-benchmark=HK Auto, HK AnyTLS')
    expect(quantumultx).not.toContain('url-latency-benchmark=HK Auto, HK AnyTLS,US AnyTLS')
    expect(egern.policy_groups.find((group) => group.auto_test?.name === 'HK Auto')?.auto_test?.policies)
      .toEqual(['HK AnyTLS'])
  })
})

function decodeSsrUri(uri: string): Record<string, string> {
  const decoded = decodeBase64Url(uri.slice('ssr://'.length))
  const [main, query = ''] = decoded.split('/?')
  const [server, port, protocol, method, obfs, password] = (main ?? '').split(':')
  const params = new URLSearchParams(query)
  return {
    server: server ?? '',
    port: port ?? '',
    protocol: protocol ?? '',
    method: method ?? '',
    obfs: obfs ?? '',
    password: decodeBase64Url(password ?? ''),
    remarks: decodeBase64Url(params.get('remarks') ?? ''),
    obfsParam: decodeBase64Url(params.get('obfsparam') ?? ''),
    protocolParam: decodeBase64Url(params.get('protoparam') ?? ''),
    group: decodeBase64Url(params.get('group') ?? ''),
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}
