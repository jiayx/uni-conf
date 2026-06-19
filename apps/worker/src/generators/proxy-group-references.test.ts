import { describe, expect, it } from 'vitest'
import type { ProxyGroup, ProxyNode } from '@uni-conf/types'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'

const createdAt = '2026-01-01T00:00:00.000Z'

const ssNode: ProxyNode = {
  id: 'node-ss',
  sourceId: 'source-1',
  name: 'Supported SS',
  protocol: 'ss',
  server: '127.0.0.1',
  port: 8388,
  enabled: true,
  tags: [],
  rawConfig: {},
  parsedConfig: {
    protocol: 'ss',
    server: '127.0.0.1',
    port: 8388,
    password: 'password',
    extra: { cipher: 'aes-128-gcm' },
  },
  isManual: false,
  createdAt,
  updatedAt: createdAt,
}

const mihomoUnsupportedNode: ProxyNode = {
  ...ssNode,
  id: 'node-wireguard',
  name: 'Unsupported WireGuard',
  protocol: 'wireguard',
  parsedConfig: {
    protocol: 'wireguard',
    server: '127.0.0.2',
    port: 51820,
    extra: {},
  },
}

const anytlsNode: ProxyNode = {
  ...ssNode,
  id: 'node-anytls',
  name: 'HK AnyTLS',
  protocol: 'anytls',
  server: 'hk.example.com',
  port: 443,
  parsedConfig: {
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
  },
}

const singboxUnsupportedNode: ProxyNode = {
  ...ssNode,
  id: 'node-unknown',
  name: 'Unsupported Unknown',
  protocol: 'unknown',
  parsedConfig: {
    protocol: 'unknown',
    server: '127.0.0.3',
    port: 10000,
    extra: {},
  },
}

const autoGroup: ProxyGroup = {
  id: 'group-auto',
  name: 'Auto',
  type: 'url-test',
  collectionIds: ['collection-auto'],
  groupIds: [],
  builtins: [],
  enabled: true,
  order: 0,
  isBuiltin: false,
  createdAt,
  updatedAt: createdAt,
}

describe('proxy group references', () => {
  it('exports AnyTLS nodes for Mihomo preview configs', () => {
    const content = generateMihomoYaml(
      [anytlsNode],
      [autoGroup],
      [],
      [],
      { 'collection-auto': [anytlsNode.name] }
    )

    expect(content).toContain('proxies:\n  - {name: "HK AnyTLS", type: anytls')
    expect(content).toContain('password: "secret"')
    expect(content).toContain('client-fingerprint: "chrome"')
    expect(content).toContain('alpn: ["h2", "http/1.1"]')
    expect(content).toContain('- "HK AnyTLS"')
  })

  it('does not reference nodes missing from Mihomo proxies', () => {
    const content = generateMihomoYaml(
      [ssNode, mihomoUnsupportedNode],
      [autoGroup],
      [],
      [],
      { 'collection-auto': [ssNode.name, mihomoUnsupportedNode.name] }
    )

    expect(content).toContain('name: "Supported SS"')
    expect(content).toContain('- "Supported SS"')
    expect(content).not.toContain('Unsupported WireGuard')
  })

  it('does not reference nodes missing from sing-box outbounds', () => {
    const content = generateSingboxJson(
      [ssNode, singboxUnsupportedNode],
      [autoGroup],
      [],
      [],
      { 'collection-auto': [ssNode.name, singboxUnsupportedNode.name] }
    )
    const config = JSON.parse(content) as { outbounds: Array<{ tag: string; outbounds?: string[] }> }
    const tags = new Set(config.outbounds.map((outbound) => outbound.tag))
    const auto = config.outbounds.find((outbound) => outbound.tag === autoGroup.name)

    expect(tags.has(ssNode.name)).toBe(true)
    expect(tags.has(singboxUnsupportedNode.name)).toBe(false)
    expect(auto?.outbounds).toEqual([ssNode.name])
  })
})
