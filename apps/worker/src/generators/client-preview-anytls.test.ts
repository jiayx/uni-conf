import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
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

  it('exports AnyTLS nodes in Loon preview', () => {
    const content = generateLoon([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-latency-benchmark, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Surge preview', () => {
    const content = generateSurge([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Shadowrocket preview', () => {
    const content = generateShadowrocket([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Quantumult X preview', () => {
    const content = generateQuantumultX([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)

    expect(content).toContain('anytls://secret@hk.example.com:443')
    expect(content).toContain('url-latency-benchmark=HK Auto, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Egern preview', () => {
    const content = generateEgern([anytlsRow], [autoGroupRow], [], [], collectionNodeNames)
    const config = yaml.load(content) as {
      proxies: Array<Record<string, unknown>>;
      policy_groups: Array<{ name: string; policies: string[] }>;
    }

    expect(config.proxies).toContainEqual(expect.objectContaining({
      name: 'HK AnyTLS',
      type: 'anytls',
      server: 'hk.example.com',
    }))
    expect(config.policy_groups.find((group) => group.name === 'HK Auto')?.policies).toEqual(['HK AnyTLS'])
  })

  it('does not add unrelated exported nodes to scoped groups', () => {
    const rows = [anytlsRow, otherRow]
    const loon = generateLoon(rows, [autoGroupRow], [], [], collectionNodeNames)
    const surge = generateSurge(rows, [autoGroupRow], [], [], collectionNodeNames)
    const shadowrocket = generateShadowrocket(rows, [autoGroupRow], [], [], collectionNodeNames)
    const quantumultx = generateQuantumultX(rows, [autoGroupRow], [], [], collectionNodeNames)
    const egern = yaml.load(generateEgern(rows, [autoGroupRow], [], [], collectionNodeNames)) as {
      policy_groups: Array<{ name: string; policies: string[] }>;
    }

    expect(loon).toContain('HK Auto = url-latency-benchmark, HK AnyTLS')
    expect(loon).not.toContain('HK Auto = url-latency-benchmark, HK AnyTLS, US AnyTLS')
    expect(surge).toContain('HK Auto = url-test, HK AnyTLS')
    expect(surge).not.toContain('HK Auto = url-test, HK AnyTLS, US AnyTLS')
    expect(shadowrocket).toContain('HK Auto = url-test, HK AnyTLS')
    expect(shadowrocket).not.toContain('HK Auto = url-test, HK AnyTLS, US AnyTLS')
    expect(quantumultx).toContain('url-latency-benchmark=HK Auto, HK AnyTLS')
    expect(quantumultx).not.toContain('url-latency-benchmark=HK Auto, HK AnyTLS,US AnyTLS')
    expect(egern.policy_groups.find((group) => group.name === 'HK Auto')?.policies).toEqual(['HK AnyTLS'])
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
