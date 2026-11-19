import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { buildStructuredProxyConfig, readNodeNetworkOptions } from '@uni-conf/shared'
import type { ExportFormat, ProxyNode, ProxyProtocol } from '@uni-conf/types'
import type { ExportData } from '../export-data'
import { generateLoon } from './loon'
import { generateEgern, generateQuantumultX, generateStashYaml, generateSurge } from './client-configs'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'
import { parseClashYaml, parseRawLines } from '../services/source-parser'
import { resolveExportWarnings } from '../services/export-validation'

function makeNode(protocol: ProxyProtocol, extra: Record<string, unknown> = {}): ProxyNode {
  return {
    id: 'node', sourceId: 'manual', name: 'Relay', protocol, server: 'example.com', port: 443,
    enabled: true, tags: [], isManual: true, rawConfig: {}, createdAt: '', updatedAt: '',
    parsedConfig: buildStructuredProxyConfig(protocol, 'example.com', 443, {
      password: 'secret', uuid: 'test-uuid', method: 'aes-256-gcm', ...extra,
    }),
  }
}

function row(node: ProxyNode): Record<string, unknown> {
  return { ...node, parsed_config: node.parsedConfig }
}

function yamlProxies(content: string): Record<string, unknown>[] {
  return (load(content) as { proxies: Record<string, unknown>[] }).proxies
}

function exportData(node: ProxyNode): ExportData {
  return { nodes: [node], nodeRows: [row(node)], groups: [], rules: [],
    remoteSets: [], sources: [], groupRows: [], ruleRows: [], remoteSetRows: [], sourceRows: [], collectionNodeNames: {} }
}

describe('node UDP and QUIC settings', () => {
  it.each(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria2', 'anytls', 'socks5'] as const)(
    'exports explicit true and false values to Loon for %s', protocol => {
      for (const udp of [true, false]) {
        for (const blockQuic of [true, false]) {
          const content = generateLoon([row(makeNode(protocol, { udp, blockQuic }))], [], [], [])
          const proxy = content.split('\n').find(line => line.startsWith('Relay ='))!
          expect(proxy).toContain(`udp=${udp}`)
          expect(proxy).toContain(`block-quic=${blockQuic}`)
          expect(proxy.match(/\budp=/g)).toHaveLength(1)
        }
      }
    },
  )

  it('omits unspecified fields and accepts false/on/off aliases without truthiness coercion', () => {
    const content = generateLoon([row(makeNode('vmess'))], [], [], [])
    const proxy = content.split('\n').find(line => line.startsWith('Relay ='))!
    expect(proxy).not.toContain('udp=')
    expect(proxy).not.toContain('block-quic=')
    expect(readNodeNetworkOptions({ 'udp-relay': 'false', 'block-quic': 'off' }))
      .toEqual({ udp: false, blockQuic: false })
    expect(readNodeNetworkOptions({ udp_relay: 1, block_quic: 'on' }))
      .toEqual({ udp: true, blockQuic: true })
    expect(readNodeNetworkOptions({ udp: '', 'block-quic': 'auto' })).toEqual({})
    expect(readNodeNetworkOptions(null)).toEqual({})
    expect(generateLoon([row(makeNode('ss', { udp: 'false', blockQuic: 'false' }))], [], [], []))
      .toContain('udp=false,block-quic=false')
  })

  it('uses the native Surge, Stash and Egern QUIC representations', () => {
    const node = makeNode('ss', { udp: true, blockQuic: false })
    expect(generateSurge([row(node)], [], [], [])).toContain('udp-relay=true, block-quic=off')
    const stash = generateStashYaml([node], [], [], [])
    expect(yamlProxies(stash)[0]).toMatchObject({ udp: true, 'block-quic': 'off' })
    expect(stash).not.toContain('PROTOCOL,QUIC,REJECT')
    expect(load(generateEgern([row(node)], [], [], []))).toMatchObject({
      proxies: [{ shadowsocks: { udp_relay: true, block_quic: false } }],
    })
    const blocked = makeNode('ss', { udp: false, blockQuic: true })
    expect(generateSurge([row(blocked)], [], [], [])).toContain('udp-relay=false, block-quic=on')
    expect(yamlProxies(generateStashYaml([blocked], [], [], []))[0])
      .toMatchObject({ udp: false, 'block-quic': 'on' })
    expect(load(generateEgern([row(blocked)], [], [], []))).toMatchObject({
      proxies: [{ shadowsocks: { udp_relay: false, block_quic: true } }],
    })
  })

  it.each(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'socks5', 'anytls', 'hysteria2', 'tuic'] as const)(
    'preserves the Mihomo UDP setting for %s', protocol => {
      const node = makeNode(protocol, { udp: false })
      expect(yamlProxies(generateMihomoYaml([node], [], [], []))[0]).toMatchObject({ udp: false })
    },
  )

  it('overrides native Mihomo fields while retaining unrelated native options', () => {
    const [parsed] = parseClashYaml('proxies:\n  - {name: Relay, type: ss, server: example.com, port: 443, cipher: aes-256-gcm, password: secret, udp: true, block-quic: on, tfo: true}')
    const node = { ...makeNode('ss'), ...parsed!, parsedConfig: {
      ...parsed!.parsedConfig, extra: { ...parsed!.parsedConfig.extra, udp: false, blockQuic: false },
    } }
    expect(parsed!.parsedConfig.extra).toMatchObject({ udp: true, blockQuic: true })
    expect(yamlProxies(generateStashYaml([node], [], [], []))[0])
      .toMatchObject({ udp: false, 'block-quic': 'off', tfo: true })
    const mihomoProxy = yamlProxies(generateMihomoYaml([node], [], [], []))[0]!
    expect(mihomoProxy).toMatchObject({ udp: false, tfo: true })
    expect(mihomoProxy).not.toHaveProperty('block-quic')
  })

  it('does not confuse option-like text in names or passwords with actual fields', () => {
    const node = makeNode('ss', { password: 'secret, udp: false', udp: true, blockQuic: false })
    node.name = 'Relay, block-quic: on'
    expect(yamlProxies(generateStashYaml([node], [], [], []))[0])
      .toMatchObject({ name: node.name, password: 'secret, udp: false', udp: true, 'block-quic': 'off' })
  })

  it('restricts sing-box UDP with network=tcp, including native outbounds', () => {
    const node = makeNode('ss', { udp: false })
    const config = JSON.parse(generateSingboxJson([node], [], [], []))
    expect(config.outbounds[0]).toMatchObject({ type: 'shadowsocks', network: 'tcp' })
    node.rawConfig = { type: 'shadowsocks', server: node.server, server_port: node.port,
      method: 'aes-256-gcm', password: 'secret', network: 'tcp', plugin: 'obfs-local' }
    node.parsedConfig.extra.udp = true
    const outbound = JSON.parse(generateSingboxJson([node], [], [], [])).outbounds[0]
    expect(outbound).not.toHaveProperty('network')
    expect(outbound.plugin).toBe('obfs-local')
    node.rawConfig.network = ['udp']
    expect(JSON.parse(generateSingboxJson([node], [], [], [])).outbounds[0].network).toEqual(['udp'])
    const anytls = JSON.parse(generateSingboxJson([makeNode('anytls', { udp: false })], [], [], [])).outbounds[0]
    expect(anytls).not.toHaveProperty('network')
  })

  it.each(['trojan', 'vless', 'hysteria2', 'anytls', 'socks5'])(
    'normalizes imported URI network options for %s', protocol => {
      const [node] = parseRawLines([`${protocol}://secret@example.com:443?udp=false&block-quic=off#Relay`])
      expect(node?.parsedConfig.extra).toMatchObject({ udp: false, blockQuic: false })
    },
  )

  it('exports Quantumult X UDP without inventing a node QUIC parameter', () => {
    const content = generateQuantumultX([row(makeNode('ss', { udp: false, blockQuic: false }))], [], [], [])
    expect(content).toContain('udp-relay=false')
    expect(content).not.toContain('block-quic')
  })

  it.each(['mihomo', 'singbox', 'quantumultx', 'shadowrocket', 'nodes_raw'] as ExportFormat[])(
    'reports unavailable per-node QUIC control for %s', format => {
      const node = makeNode('ss', { udp: true, blockQuic: false })
      expect(resolveExportWarnings(exportData(node), format, { showCompatibilityWarnings: true })).toContainEqual(
        expect.objectContaining({ code: 'node-network-option-unsupported', nodeId: 'node', level: 'partial' }),
      )
    },
  )

  it.each(['surge', 'singbox'] as const)('warns when %s cannot disable automatic AnyTLS UDP', format => {
    const node = makeNode('anytls', { udp: false })
    expect(resolveExportWarnings(exportData(node), format, { showCompatibilityWarnings: true }))
      .toContainEqual(expect.objectContaining({
        code: 'node-network-option-unsupported', message: expect.stringContaining('udp=false'),
      }))
    expect(generateSurge([row(node)], [], [], [])).not.toContain('udp-relay=false')
  })

  it.each(['loon', 'surge', 'stash', 'egern'] as const)('does not warn about supported options in %s', format => {
    const node = makeNode('ss', { udp: true, blockQuic: false })
    expect(resolveExportWarnings(exportData(node), format, { showCompatibilityWarnings: true }))
      .not.toContainEqual(expect.objectContaining({ code: 'node-network-option-unsupported' }))
  })
})
