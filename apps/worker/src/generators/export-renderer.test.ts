import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import {
  EXPORT_SUBSCRIPTION_FORMATS,
  isNodeProtocolSupportedByExport,
} from '@uni-conf/shared'
import { PROXY_PROTOCOL_REGISTRY } from '@uni-conf/types'
import type { ExportFormat, ProxyGroup, ProxyNode, ProxyProtocol, ProxyRule } from '@uni-conf/types'
import type { ExportData } from '../export-data'
import { renderExportData } from './export-renderer'
import { validateRenderedExport } from '../services/export-artifact-validation'

const require = createRequire(import.meta.url)
const mihomoSchema = JSON.parse(
  readFileSync(require.resolve('meta-json-schema/schemas/meta-json-schema.json'), 'utf8')
) as Record<string, unknown>
const validateMihomoSchema = new Ajv({ strict: false }).compile(mihomoSchema)
const singboxSchema = JSON.parse(
  readFileSync(require.resolve('@black-duty/sing-box-schema/schema.json'), 'utf8')
) as Record<string, unknown>
removeLegacySchemaIds(singboxSchema)
const validateSingboxSchema = new Ajv2020({ strict: false }).compile(singboxSchema)

describe('renderExportData', () => {
  it('renders every public subscription format from the shared format list', () => {
    for (const format of EXPORT_SUBSCRIPTION_FORMATS) {
      const rendered = renderExportData(makeExportData(), format as ExportFormat)

      expect(rendered, `${format} should render`).not.toBeNull()
      expect(rendered?.content.trim().length, `${format} should not be empty`).toBeGreaterThan(0)
      expect(rendered?.contentType, `${format} should set content type`).toContain('charset=utf-8')
      expect(
        validateRenderedExport(format as ExportFormat, rendered?.content ?? ''),
        `${format} should pass runtime artifact validation`
      ).toMatchObject({ valid: true, issues: [] })
    }
  })

  it('serializes node-only subscription formats from the same node rows used by full configs', () => {
    const raw = renderExportData(makeExportData(), 'nodes_raw')
    const encoded = renderExportData(makeExportData(), 'nodes_base64')

    expect(raw?.content).toContain('ss://')
    expect(raw?.content).toContain('#Smoke%20SS')
    expect(Buffer.from(encoded?.content ?? '', 'base64').toString('utf8')).toBe(raw?.content)
  })

  it('emits parseable structures for structured full-config formats', () => {
    const data = makeExportData()
    const mihomo = yaml.load(renderExportData(data, 'mihomo')?.content ?? '') as { proxies?: unknown[]; rules?: unknown[] }
    const clash = yaml.load(renderExportData(data, 'clash')?.content ?? '') as { proxies?: unknown[]; rules?: unknown[] }
    const stash = yaml.load(renderExportData(data, 'stash')?.content ?? '') as { proxies?: unknown[]; rules?: unknown[] }
    const singbox = JSON.parse(renderExportData(data, 'singbox')?.content ?? '{}') as {
      outbounds?: unknown[]
      route?: { rules?: unknown[] }
    }

    for (const parsed of [mihomo, clash, stash]) {
      expect(parsed.proxies?.length).toBeGreaterThan(0)
      expect(parsed.rules?.length).toBeGreaterThan(0)
    }
    expect(singbox.outbounds?.length).toBeGreaterThan(0)
    expect(singbox.route?.rules?.length).toBeGreaterThan(0)
  })

  it('keeps the client capability registry aligned with every node serializer', () => {
    for (const format of EXPORT_SUBSCRIPTION_FORMATS) {
      for (const protocol of Object.keys(PROXY_PROTOCOL_REGISTRY) as ProxyProtocol[]) {
        const data = makeExportData(protocol)
        const rendered = renderExportData(data, format as ExportFormat)
        const expected = isNodeProtocolSupportedByExport(protocol, format)

        expect(
          renderedContainsNode(format as ExportFormat, rendered?.content ?? '', data.nodes[0]!.server),
          `${format} exporter support for ${protocol} must match the shared capability registry`
        ).toBe(expected)
      }
    }
  })

  it('matches the stable sing-box 1.13 schema for every advertised node protocol', () => {
    for (const protocol of Object.keys(PROXY_PROTOCOL_REGISTRY) as ProxyProtocol[]) {
      if (!isNodeProtocolSupportedByExport(protocol, 'singbox')) continue
      const rendered = renderExportData(makeExportData(protocol), 'singbox')
      const parsed = JSON.parse(rendered?.content ?? '{}') as Record<string, unknown>

      expect(
        validateSingboxSchema(parsed),
        `${protocol}: ${JSON.stringify(validateSingboxSchema.errors)}`
      ).toBe(true)
      expect(parsed).toMatchObject({
        route: { default_domain_resolver: 'localDns' },
      })
    }
  })

  it('matches the current Mihomo schema for every advertised node protocol', () => {
    for (const protocol of Object.keys(PROXY_PROTOCOL_REGISTRY) as ProxyProtocol[]) {
      if (!isNodeProtocolSupportedByExport(protocol, 'mihomo')) continue
      const rendered = renderExportData(makeExportData(protocol), 'mihomo')
      const parsed = yaml.load(rendered?.content ?? '') as Record<string, unknown>

      expect(
        validateMihomoSchema(parsed),
        `${protocol}: ${JSON.stringify(validateMihomoSchema.errors)}`
      ).toBe(true)
    }
  })

  it('uses Stash-native credential and protocol fields', () => {
    const hysteria = yaml.load(renderExportData(makeExportData('hysteria'), 'stash')?.content ?? '') as {
      proxies: Array<Record<string, unknown>>;
    }
    const hysteria2 = yaml.load(renderExportData(makeExportData('hysteria2'), 'stash')?.content ?? '') as {
      proxies: Array<Record<string, unknown>>;
    }
    const tuic = yaml.load(renderExportData(makeExportData('tuic'), 'stash')?.content ?? '') as {
      proxies: Array<Record<string, unknown>>;
    }

    expect(hysteria.proxies[0]).toMatchObject({
      type: 'hysteria',
      'up-speed': 100,
      'down-speed': 100,
    })
    expect(hysteria.proxies[0]).not.toHaveProperty('up')
    expect(hysteria2.proxies[0]).toMatchObject({ type: 'hysteria2', auth: 'password' })
    expect(hysteria2.proxies[0]).not.toHaveProperty('password')
    expect(tuic.proxies[0]).toMatchObject({ type: 'tuic', version: 5 })
  })

  it('keeps imported multi-peer WireGuard endpoints valid against the stable sing-box schema', () => {
    const data = makeExportData('wireguard')
    data.nodes[0] = {
      ...data.nodes[0]!,
      name: 'Current WireGuard',
      server: 'primary-current.example.com',
      port: 51822,
      rawConfig: {
        type: 'wireguard',
        tag: 'Imported WireGuard',
        address: ['10.0.0.2/32'],
        private_key: 'imported-private-key',
        peers: [
          {
            address: 'primary-imported.example.com',
            port: 51820,
            public_key: 'imported-primary-key',
            allowed_ips: ['0.0.0.0/0'],
          },
          {
            address: 'backup.example.com',
            port: 51821,
            public_key: 'backup-key',
            allowed_ips: ['10.0.0.0/8'],
          },
        ],
      },
      parsedConfig: {
        protocol: 'wireguard',
        server: 'primary-current.example.com',
        port: 51822,
        extra: {
          privateKey: 'current-private-key',
          publicKey: 'current-primary-key',
          address: ['10.0.0.3/32'],
          allowedIPs: ['0.0.0.0/0', '::/0'],
        },
      },
    }

    const rendered = renderExportData(data, 'singbox')
    const parsed = JSON.parse(rendered?.content ?? '{}') as {
      endpoints?: Array<{ peers?: Array<{ address?: string }> }>;
    }
    expect(
      validateSingboxSchema(parsed),
      JSON.stringify(validateSingboxSchema.errors),
    ).toBe(true)
    expect(parsed.endpoints?.[0]?.peers).toEqual([
      expect.objectContaining({ address: 'primary-current.example.com' }),
      expect.objectContaining({ address: 'backup.example.com' }),
    ])
  })

  it('matches the stable sing-box 1.13 schema for source and process rule fields', () => {
    const data = makeExportData()
    const rules: Array<[ProxyRule['type'], string]> = [
      ['SRC-IP-CIDR', '10.0.0.0/8'],
      ['PORT', '8000-9000'],
      ['SRC-PORT', '1000-2000'],
      ['PROCESS-PATH', '/usr/bin/curl'],
      ['PROTOCOL', 'http'],
      ['NETWORK', 'tcp'],
    ]
    data.rules = rules.map(([type, payload], index) => ({
      id: `rule-${index}`,
      type,
      payload,
      targetGroupId: data.groups[0]!.id,
      enabled: true,
      order: index,
      compatibility: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))

    const parsed = JSON.parse(renderExportData(data, 'singbox')?.content ?? '{}') as Record<string, unknown>

    expect(
      validateSingboxSchema(parsed),
      JSON.stringify(validateSingboxSchema.errors)
    ).toBe(true)
  })

  it.each([
    ['ss', 'shadowsocks'],
    ['ssr', 'shadowsocks'],
    ['vmess', 'vmess'],
    ['vless', 'vless'],
    ['trojan', 'trojan'],
    ['anytls', 'anytls'],
    ['socks5', 'socks5'],
    ['http', 'http'],
    ['https', 'http'],
  ] as Array<[ProxyProtocol, string]>)(
    'renders %s as a native Quantumult X server entry',
    (protocol, nativeType) => {
      const rendered = renderExportData(makeExportData(protocol), 'quantumultx')
      const content = rendered?.content ?? ''
      const localSection = content.split('[server_local]\n')[1]?.split('\n[policy]')[0] ?? ''

      expect(localSection).toContain(`${nativeType}=smoke-${protocol}.example.com:8388`)
      expect(localSection).toContain('tag=Smoke SS')
      expect(localSection).not.toContain('://')
      expect(validateRenderedExport('quantumultx', content)).toMatchObject({
        valid: true,
        issues: [],
      })
    }
  )

  it.each([
    ['ss', 'Shadowsocks'],
    ['ssr', 'ShadowsocksR'],
    ['vmess', 'vmess'],
    ['vless', 'VLESS'],
    ['trojan', 'trojan'],
    ['hysteria2', 'Hysteria2'],
    ['http', 'http'],
    ['https', 'https'],
  ] as Array<[ProxyProtocol, string]>)(
    'renders %s as a native Loon proxy entry',
    (protocol, nativeType) => {
      const rendered = renderExportData(makeExportData(protocol), 'loon')
      const content = rendered?.content ?? ''
      const proxySection = content.split('[Proxy]\n')[1]?.split('\n[Remote Proxy]')[0] ?? ''

      expect(proxySection).toContain(`Smoke SS = ${nativeType}`)
      expect(validateRenderedExport('loon', content)).toMatchObject({
        valid: true,
        issues: [],
      })
    }
  )

  it.each([
    ['ss', 'ss'],
    ['vmess', 'vmess'],
    ['trojan', 'trojan'],
    ['hysteria2', 'hysteria2'],
    ['anytls', 'anytls'],
    ['socks5', 'socks5'],
    ['http', 'http'],
    ['https', 'https'],
  ] as Array<[ProxyProtocol, string]>)(
    'renders %s as a native Surge proxy entry',
    (protocol, nativeType) => {
      const rendered = renderExportData(makeExportData(protocol), 'surge')
      const content = rendered?.content ?? ''
      const proxySection = content.split('[Proxy]\n')[1]?.split('\n[Proxy Group]')[0] ?? ''

      expect(proxySection).toContain(`Smoke SS = ${nativeType}, smoke-${protocol}.example.com, 8388`)
      expect(validateRenderedExport('surge', content)).toMatchObject({
        valid: true,
        issues: [],
      })
    }
  )

  it.each([
    ['ss', 'shadowsocks'],
    ['vmess', 'vmess'],
    ['vless', 'vless'],
    ['trojan', 'trojan'],
    ['hysteria2', 'hysteria2'],
    ['tuic', 'tuic'],
    ['anytls', 'anytls'],
    ['socks5', 'socks5'],
    ['http', 'http'],
    ['https', 'https'],
    ['ssh', 'ssh'],
    ['wireguard', 'wireguard'],
  ] as Array<[ProxyProtocol, string]>)(
    'renders %s as a native Egern proxy entry',
    (protocol, nativeType) => {
      const rendered = renderExportData(makeExportData(protocol), 'egern')
      const content = rendered?.content ?? ''
      const parsed = yaml.load(content) as { proxies?: Array<Record<string, unknown>> }

      expect(parsed.proxies).toContainEqual(expect.objectContaining({
        [nativeType]: expect.objectContaining({
          name: 'Smoke SS',
          server: `smoke-${protocol}.example.com`,
          port: 8388,
        }),
      }))
      expect(validateRenderedExport('egern', content)).toMatchObject({
        valid: true,
        issues: [],
      })
    }
  )
})

function makeExportData(protocol: ProxyProtocol = 'ss'): ExportData {
  const node = makeNode(protocol)
  const nodeRow = makeNodeRow(protocol)
  const group = makeGroup()
  const groupRow = makeGroupRow()

  return {
    nodeRows: [nodeRow],
    groupRows: [groupRow],
    ruleRows: [],
    remoteSetRows: [],
    sourceRows: [],
    sources: [],
    nodes: [node],
    groups: [group],
    rules: [],
    remoteSets: [],
    collectionNodeNames: {
      'collection-all': [node.name],
    },
  }
}

function makeNode(protocol: ProxyProtocol = 'ss'): ProxyNode {
  return {
    id: 'node-1',
    sourceId: 'source-1',
    name: 'Smoke SS',
    protocol,
    server: `smoke-${protocol}.example.com`,
    port: 8388,
    country: 'United States',
    countryCode: 'US',
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: {
      protocol,
      server: `smoke-${protocol}.example.com`,
      port: 8388,
      password: 'password',
      uuid: '00000000-0000-4000-8000-000000000001',
      tls: protocol === 'vless',
      extra: {
        cipher: 'aes-256-gcm',
        username: 'user',
        privateKey: 'private-key',
        publicKey: 'public-key',
        ip: '10.0.0.2/32',
      },
    },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeNodeRow(protocol: ProxyProtocol = 'ss'): Record<string, unknown> {
  const node = makeNode(protocol)
  return {
    id: node.id,
    source_id: node.sourceId,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    country: node.country,
    country_code: node.countryCode,
    enabled: 1,
    tags: JSON.stringify(node.tags),
    raw_config: JSON.stringify(node.rawConfig),
    parsed_config: JSON.stringify(node.parsedConfig),
    is_manual: 0,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  }
}

function renderedContainsNode(format: ExportFormat, content: string, server: string): boolean {
  if (format === 'mihomo' || format === 'clash' || format === 'stash') {
    const parsed = yaml.load(content) as { proxies?: Array<{ server?: string }> }
    return parsed.proxies?.some((proxy) => proxy.server === server) ?? false
  }
  if (format === 'singbox') {
    const parsed = JSON.parse(content) as {
      endpoints?: Array<{ peers?: Array<{ address?: string }> }>;
      outbounds?: Array<{ server?: string }>;
    }
    return (parsed.outbounds?.some((outbound) => outbound.server === server) ?? false)
      || (parsed.endpoints?.some((endpoint) =>
        endpoint.peers?.some((peer) => peer.address === server)
      ) ?? false)
  }
  if (format === 'egern') {
    const parsed = yaml.load(content) as { proxies?: Array<Record<string, { server?: string }>> }
    return parsed.proxies?.some((proxy) =>
      Object.values(proxy).some((body) => body?.server === server)
    ) ?? false
  }
  if (format === 'nodes_base64') {
    return Buffer.from(content, 'base64').toString('utf8').trim().length > 0
  }
  if (format === 'nodes_raw') {
    return content.trim().length > 0
  }
  if (format === 'quantumultx') {
    const localSection = content.split('[server_local]\n')[1]?.split('\n[policy]')[0] ?? ''
    return localSection.trim().length > 0
  }
  return content.includes(server)
}

function removeLegacySchemaIds(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) removeLegacySchemaIds(item)
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.id === 'string') delete record.id
  for (const child of Object.values(record)) removeLegacySchemaIds(child)
}

function makeGroup(): ProxyGroup {
  return {
    id: 'group-proxy',
    name: 'PROXY',
    type: 'select',
    collectionIds: ['collection-all'],
    groupIds: [],
    builtins: [],
    enabled: true,
    order: 0,
    isBuiltin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeGroupRow(): Record<string, unknown> {
  const group = makeGroup()
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    collection_ids: JSON.stringify(group.collectionIds),
    group_ids: JSON.stringify(group.groupIds),
    builtins: JSON.stringify(group.builtins),
    enabled: 1,
    sort_order: group.order,
    is_builtin: 1,
    created_at: group.createdAt,
    updated_at: group.updatedAt,
  }
}
