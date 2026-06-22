import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import type { ProxyGroup, ProxyNode } from '@uni-conf/types'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'
import { generateEgern, generateQuantumultX, generateSurge } from './client-configs'
import { generateLoon } from './loon'

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

const directGroup: ProxyGroup = {
  ...autoGroup,
  id: 'builtin-direct',
  name: 'DIRECT',
  type: 'direct',
  collectionIds: [],
  isBuiltin: true,
}

const rejectGroup: ProxyGroup = {
  ...autoGroup,
  id: 'builtin-reject',
  name: 'REJECT',
  type: 'reject',
  collectionIds: [],
  isBuiltin: true,
}

describe('proxy group references', () => {
  it('uses smart DNS mode by default for Mihomo configs', () => {
    const content = generateMihomoYaml([], [], [], [])

    expect(content).toContain('enhanced-mode: redir-host')
    expect(content).toContain('fallback-filter:')
    expect(content).toContain('nameserver-policy:')
    expect(content).not.toContain('fake-ip-range:')
  })

  it('can generate compatible and fake-ip DNS modes', () => {
    const compatible = generateMihomoYaml([], [], [], [], {}, { dnsMode: 'compatible' })
    const fakeIp = generateMihomoYaml([], [], [], [], {}, { dnsMode: 'fake-ip' })

    expect(compatible).toContain('enhanced-mode: redir-host')
    expect(compatible).not.toContain('fallback-filter:')
    expect(fakeIp).toContain('enhanced-mode: fake-ip')
    expect(fakeIp).toContain('fake-ip-filter:')
  })

  it('maps DNS mode to sing-box fakeip settings', () => {
    const smart = JSON.parse(generateSingboxJson([], [], [], [])) as {
      dns: Record<string, unknown>;
      experimental: { cache_file: { store_fakeip: boolean } };
    }
    const fakeIp = JSON.parse(generateSingboxJson([], [], [], [], {}, { dnsMode: 'fake-ip' })) as {
      dns: Record<string, unknown>;
      experimental: { cache_file: { store_fakeip: boolean } };
    }

    expect(smart.dns.fakeip).toBeUndefined()
    expect(smart.experimental.cache_file.store_fakeip).toBe(false)
    expect(fakeIp.dns.fakeip).toEqual(expect.objectContaining({ enabled: true }))
    expect(fakeIp.experimental.cache_file.store_fakeip).toBe(true)
  })

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

  it('uses Mihomo built-in DIRECT and REJECT policies without emitting invalid groups', () => {
    const content = generateMihomoYaml(
      [],
      [directGroup, rejectGroup],
      [
        {
          id: 'rule-direct',
          type: 'DOMAIN',
          payload: 'example.com',
          targetGroupId: directGroup.id,
          enabled: true,
          order: 1,
          compatibility: [],
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'rule-reject',
          type: 'DOMAIN-SUFFIX',
          payload: 'ads.example',
          targetGroupId: rejectGroup.id,
          enabled: true,
          order: 2,
          compatibility: [],
          createdAt,
          updatedAt: createdAt,
        },
      ],
      []
    )

    expect(content).toContain('proxy-groups: []')
    expect(content).not.toContain('type: direct')
    expect(content).not.toContain('type: reject')
    expect(content).toContain('  - DOMAIN,example.com,DIRECT')
    expect(content).toContain('  - DOMAIN-SUFFIX,ads.example,REJECT')
  })

  it('maps sing-box DIRECT and REJECT targets to native outbounds', () => {
    const content = generateSingboxJson(
      [],
      [directGroup, rejectGroup],
      [
        {
          id: 'rule-direct',
          type: 'DOMAIN',
          payload: 'example.com',
          targetGroupId: directGroup.id,
          enabled: true,
          order: 1,
          compatibility: [],
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'rule-reject',
          type: 'DOMAIN-SUFFIX',
          payload: 'ads.example',
          targetGroupId: rejectGroup.id,
          enabled: true,
          order: 2,
          compatibility: [],
          createdAt,
          updatedAt: createdAt,
        },
      ],
      []
    )
    const config = JSON.parse(content) as {
      outbounds: Array<{ tag: string; type: string }>;
      route: { rules: Array<Record<string, unknown>> };
    }

    expect(config.outbounds).toContainEqual(expect.objectContaining({ tag: 'direct', type: 'direct' }))
    expect(config.outbounds).toContainEqual(expect.objectContaining({ tag: 'block', type: 'block' }))
    expect(config.outbounds.some((outbound) => outbound.tag === 'DIRECT')).toBe(false)
    expect(config.outbounds.some((outbound) => outbound.tag === 'REJECT')).toBe(false)
    expect(config.route.rules).toContainEqual({ domain: ['example.com'], outbound: 'direct' })
    expect(config.route.rules).toContainEqual({ domain_suffix: ['ads.example'], outbound: 'block' })
  })

  it('does not emit native outlet groups for text based client configs', () => {
    const rows = [toRow(directGroup), toRow(rejectGroup)]
    const ruleRows = [
      {
        id: 'rule-direct',
        type: 'DOMAIN',
        payload: 'example.com',
        target_group_id: directGroup.id,
        enabled: 1,
        no_resolve: 0,
      },
      {
        id: 'rule-reject',
        type: 'DOMAIN-SUFFIX',
        payload: 'ads.example',
        target_group_id: rejectGroup.id,
        enabled: 1,
        no_resolve: 0,
      },
    ]

    const surge = generateSurge([], rows, ruleRows, [])
    const loon = generateLoon([], rows, ruleRows, [])
    const qx = generateQuantumultX([], rows, ruleRows, [])
    const egern = yaml.load(generateEgern([], rows, ruleRows, [])) as {
      policy_groups: Array<{ name: string }>;
      rules: Array<Record<string, unknown>>;
    }

    expect(surge).not.toContain('DIRECT = select')
    expect(surge).not.toContain('REJECT = select')
    expect(surge).toContain('DOMAIN,example.com,DIRECT')
    expect(surge).toContain('DOMAIN-SUFFIX,ads.example,REJECT')
    expect(loon).not.toContain('DIRECT = select')
    expect(loon).not.toContain('REJECT = select')
    expect(loon).toContain('DOMAIN, example.com, DIRECT')
    expect(loon).toContain('DOMAIN-SUFFIX, ads.example, REJECT')
    expect(qx).not.toContain('static=DIRECT')
    expect(qx).not.toContain('static=REJECT')
    expect(qx).toContain('HOST,example.com,DIRECT')
    expect(qx).toContain('HOST-SUFFIX,ads.example,REJECT')
    expect(egern.policy_groups.some((group) => group.name === 'DIRECT')).toBe(false)
    expect(egern.policy_groups.some((group) => group.name === 'REJECT')).toBe(false)
    expect(egern.rules).toContainEqual({ domain: 'example.com', policy: 'DIRECT' })
    expect(egern.rules).toContainEqual({ domain_suffix: 'ads.example', policy: 'REJECT' })
  })
})

function toRow(group: ProxyGroup): Record<string, unknown> {
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    collection_ids: JSON.stringify(group.collectionIds),
    group_ids: JSON.stringify(group.groupIds),
    builtins: JSON.stringify(group.builtins),
    enabled: group.enabled ? 1 : 0,
    test_url: group.testUrl,
    interval: group.interval,
  }
}
