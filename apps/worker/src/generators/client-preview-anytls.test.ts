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

describe('AnyTLS preview generators', () => {
  it('exports AnyTLS node subscription URIs', () => {
    const content = generateNodeSubscriptionRaw([anytlsRow])

    expect(content).toContain('anytls://secret@hk.example.com:443')
    expect(content).toContain('sni=hk.example.com')
    expect(content).toContain('fp=chrome')
  })

  it('exports AnyTLS nodes in Loon preview', () => {
    const content = generateLoon([anytlsRow], [autoGroupRow], [], [])

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-latency-benchmark, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Surge preview', () => {
    const content = generateSurge([anytlsRow], [autoGroupRow], [], [])

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Shadowrocket preview', () => {
    const content = generateShadowrocket([anytlsRow], [autoGroupRow], [], [])

    expect(content).toContain('HK AnyTLS = anytls, hk.example.com, 443')
    expect(content).toContain('HK Auto = url-test, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Quantumult X preview', () => {
    const content = generateQuantumultX([anytlsRow], [autoGroupRow], [], [])

    expect(content).toContain('anytls://secret@hk.example.com:443')
    expect(content).toContain('url-latency-benchmark=HK Auto, HK AnyTLS')
  })

  it('exports AnyTLS nodes in Egern preview', () => {
    const content = generateEgern([anytlsRow], [autoGroupRow], [], [])
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
})
