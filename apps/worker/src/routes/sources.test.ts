import { afterEach, describe, it, expect, vi } from 'vitest'
import { detectCountry, detectTrafficMultiplier, isSubscriptionInfoNodeName, makeSourceNodeGroupMarker, SOURCE_FORMATS } from '@uni-conf/shared'
import type { SourceRefreshResult } from '@uni-conf/types'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import {
  deleteSourceById,
  deriveSourceName,
  detectAndParse,
  filterUsableParsedContent,
  isHttpUrl,
  isValidSourceFormat,
  isValidSourceType,
  parseClashGroups,
  parseClashYaml,
  parseSingboxGroups,
  refreshSourceById,
  resolveSourceNameInput,
  SourceRefreshError,
  validateSourceMutableFields,
} from './sources'
import sourcesApp from './sources'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}))

// Mock Clash YAML with multiple node formats
const MOCK_CLASH_YAML = `
port: 7890
socks-port: 7891
proxies:
    - { name: '剩余流量：111 GB', type: trojan, server: 10.255.255.255, port: 443, password: test-pwd, udp: true }
    - { name: '🇭🇰 HK 01', type: anytls, server: example.relay.org, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: firefox, sni: example.moe }
    - { name: '🇭🇰 HK 02', type: anytls, server: example.relay.org, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: ios, sni: example2.moe }
    - { name: '🇯🇵 JP 01', type: anytls, server: aws-nrt.example.moe, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: safari, sni: example3.moe }
    - name: US Server 01
      type: vmess
      server: us.example.com
      port: 443
      uuid: 12345678-1234-1234-1234-123456789012
      alterId: 0
      cipher: auto
    - name: SG Server 01
      type: trojan
      server: sg.example.com
      port: 443
      password: test-password
      udp: true
proxy-groups:
  - name: Proxy
    type: select
`

describe('Clash YAML Parser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('derives source names from subscription URLs', () => {
    expect(deriveSourceName('https://www.example.com/api/sub?token=abc')).toBe('example.com')
    expect(deriveSourceName('https://airport.example/sub')).toBe('airport.example')
    expect(deriveSourceName('not a valid url')).toBe('not a valid url')
    expect(deriveSourceName(undefined)).toBe('订阅源')
  })

  it('resolves blank source names from the subscription URL', () => {
    expect(resolveSourceNameInput('  My Airport  ', 'https://example.com/sub')).toBe('My Airport')
    expect(resolveSourceNameInput('', 'https://www.example.com/sub')).toBe('example.com')
    expect(resolveSourceNameInput('   ', 'https://airport.example/sub')).toBe('airport.example')
  })

  it('validates source input enums and subscription URLs', () => {
    expect(isValidSourceType('url')).toBe(true)
    expect(isValidSourceType('manual')).toBe(true)
    expect(isValidSourceType('remote')).toBe(false)
    expect(isValidSourceFormat('auto')).toBe(true)
    expect(isValidSourceFormat('singbox')).toBe(true)
    for (const format of SOURCE_FORMATS) {
      expect(isValidSourceFormat(format)).toBe(true)
    }
    expect(isValidSourceFormat('yaml')).toBe(false)
    expect(isHttpUrl('https://example.com/sub')).toBe(true)
    expect(isHttpUrl('  https://example.com/sub  ')).toBe(true)
    expect(isHttpUrl('http://example.com/sub')).toBe(true)
    expect(isHttpUrl('file:///tmp/sub.yaml')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })

  it('normalizes mutable source fields', () => {
    expect(validateSourceMutableFields({
      updateInterval: '60',
      userAgent: '  Clash.Meta  ',
      notes: ' note ',
      tags: [' airport ', 'airport', ''],
    })).toEqual({
      valid: true,
      updateInterval: 60,
      userAgent: 'Clash.Meta',
      notes: 'note',
      tags: ['airport'],
    })
    expect(validateSourceMutableFields({
      userAgent: '',
      notes: null,
      tags: [],
    })).toEqual({
      valid: true,
      updateInterval: undefined,
      userAgent: null,
      notes: null,
      tags: [],
    })
  })

  it('rejects malformed mutable source fields', () => {
    expect(validateSourceMutableFields({ updateInterval: -1 })).toEqual({
      valid: false,
      error: 'updateInterval must be a non-negative integer',
    })
    expect(validateSourceMutableFields({ updateInterval: 1.5 })).toEqual({
      valid: false,
      error: 'updateInterval must be a non-negative integer',
    })
    expect(validateSourceMutableFields({ tags: ['ok', 1] })).toEqual({
      valid: false,
      error: 'tags must be an array of strings',
    })
    expect(validateSourceMutableFields({ userAgent: 1 })).toEqual({
      valid: false,
      error: 'userAgent must be a string or null',
    })
    expect(validateSourceMutableFields({ notes: { text: 'note' } })).toEqual({
      valid: false,
      error: 'notes must be a string or null',
    })
  })

  it('uses explicit source format hints before auto detection', () => {
    const singbox = JSON.stringify({
      outbounds: [
        { tag: 'SG', type: 'trojan', server: 'sg.example.com', server_port: 443, password: 'pwd' },
      ],
    })

    expect(detectAndParse(singbox, 'singbox')).toMatchObject({
      format: 'singbox',
      nodes: [expect.objectContaining({ name: 'SG', protocol: 'trojan' })],
    })
    expect(detectAndParse(singbox, 'mihomo')).toMatchObject({
      format: 'mihomo',
      nodes: [],
    })
  })

  it('should parse inline format nodes (flow-style)', () => {
    const inlineYaml = `
proxies:
    - { name: 'Node 1', type: trojan, server: server1.com, port: 443, password: pwd1 }
    - { name: 'Node 2', type: anytls, server: server2.com, port: 443, password: pwd2 }
    - { name: 'Node 3', type: vmess, server: server3.com, port: 443, uuid: test-uuid }
`
    const nodes = parseClashYaml(inlineYaml)
    expect(nodes.length).toBe(3)
    expect(nodes[0]!.name).toBe('Node 1')
    expect(nodes[0]!.protocol).toBe('trojan')
    expect(nodes[1]!.name).toBe('Node 2')
    expect(nodes[1]!.protocol).toBe('anytls')
    expect(nodes[2]!.name).toBe('Node 3')
    expect(nodes[2]!.protocol).toBe('vmess')
  })

  it('should parse block format nodes (multi-line)', () => {
    const blockYaml = `
proxies:
    - name: US Server 01
      type: vmess
      server: us.example.com
      port: 443
      uuid: 12345678-1234-1234-1234-123456789012
    - name: SG Server 01
      type: trojan
      server: sg.example.com
      port: 443
      password: test-password
`
    const nodes = parseClashYaml(blockYaml)
    expect(nodes.length).toBe(2)
    expect(nodes[0]!.name).toBe('US Server 01')
    expect(nodes[0]!.protocol).toBe('vmess')
    expect(nodes[1]!.name).toBe('SG Server 01')
    expect(nodes[1]!.protocol).toBe('trojan')
  })

  it('should parse mixed format (inline + block)', () => {
    const nodes = parseClashYaml(MOCK_CLASH_YAML)
    expect(nodes.length).toBeGreaterThanOrEqual(6)

    // Check inline format nodes
    expect(nodes.some(n => n.name === '🇭🇰 HK 01')).toBe(true)
    expect(nodes.some(n => n.name === '🇯🇵 JP 01')).toBe(true)

    // Check block format nodes
    expect(nodes.some(n => n.name === 'US Server 01')).toBe(true)
    expect(nodes.some(n => n.name === 'SG Server 01')).toBe(true)
  })

  it('should support anytls protocol', () => {
    const nodes = parseClashYaml(MOCK_CLASH_YAML)
    const anytlsNodes = nodes.filter(n => n.protocol === 'anytls')
    expect(anytlsNodes.length).toBeGreaterThan(0)
  })

  it('parses mainstream raw URI schemes through the shared protocol registry', () => {
    const result = detectAndParse([
      'shadowtls://secret@sg.example.com:443?sni=sg.example.com#SG%20ShadowTLS',
      'wireguard://private-key@us.example.com:51820?public-key=peer-key&address=172.16.0.2#US%20WireGuard',
      'naive+https://user:pass@jp.example.com:443#JP%20Naive',
      'hysteria://auth-secret@tw.example.com:443?sni=tw.example.com#TW%20Hysteria',
    ].join('\n'), 'raw')

    expect(result.format).toBe('raw')
    expect(result.nodes).toEqual([
      expect.objectContaining({ name: 'SG ShadowTLS', protocol: 'shadowtls', server: 'sg.example.com', port: 443 }),
      expect.objectContaining({ name: 'US WireGuard', protocol: 'wireguard', server: 'us.example.com', port: 51820 }),
      expect.objectContaining({ name: 'JP Naive', protocol: 'naive', server: 'jp.example.com', port: 443 }),
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

  it('parses ShadowsocksR raw URI nodes from the mainstream protocol registry', () => {
    const result = detectAndParse(makeSsrUri({
      server: 'hk.example.com',
      port: 443,
      method: 'aes-256-cfb',
      password: 'secret',
      protocol: 'auth_sha1_v4',
      obfs: 'tls1.2_ticket_auth',
      name: '🇭🇰 HK SSR 01',
      obfsParam: 'cdn.example.com',
      protocolParam: '32',
    }), 'raw')

    expect(result.nodes).toEqual([
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

  it('should parse upstream proxy groups from Clash YAML', () => {
    const groupsYaml = `
proxies:
    - { name: '🇺🇸 US 01', type: trojan, server: us1.example.com, port: 443, password: pwd }
    - { name: '🇺🇸 US 02', type: trojan, server: us2.example.com, port: 443, password: pwd }
    - { name: '🇯🇵 JP 01', type: trojan, server: jp1.example.com, port: 443, password: pwd }
proxy-groups:
    - { name: 'US Auto', type: url-test, proxies: ['🇺🇸 US 01', '🇺🇸 US 02', DIRECT, direct] }
    - name: Streaming
      type: select
      proxies:
        - 🇺🇸 US 01
        - 🇯🇵 JP 01
        - REJECT
        - reject
`
    const groups = parseClashGroups(groupsYaml)

    expect(groups).toEqual([
      { name: 'US Auto', type: 'url-test', memberNames: ['🇺🇸 US 01', '🇺🇸 US 02'] },
      { name: 'Streaming', type: 'select', memberNames: ['🇺🇸 US 01', '🇯🇵 JP 01'] },
    ])
  })

  it('should parse upstream selector groups from sing-box JSON without built-in outbounds', () => {
    const groups = parseSingboxGroups({
      outbounds: [
        { type: 'trojan', tag: '🇺🇸 US 01', server: 'us.example.com', server_port: 443, password: 'pwd' },
        { type: 'selector', tag: 'Proxy', outbounds: ['🇺🇸 US 01', 'direct', 'DIRECT', 'block', 'BLOCK'] },
      ],
    })

    expect(groups).toEqual([
      { name: 'Proxy', type: 'selector', memberNames: ['🇺🇸 US 01'] },
    ])
  })

  it('should identify subscription info node names without matching normal nodes', () => {
    expect(isSubscriptionInfoNodeName('剩余流量：111 GB')).toBe(true)
    expect(isSubscriptionInfoNodeName('套餐到期：2026-12-31')).toBe(true)
    expect(isSubscriptionInfoNodeName('Traffic Used: 12 GB')).toBe(true)
    expect(isSubscriptionInfoNodeName('用户中心：https://example.com')).toBe(true)
    expect(isSubscriptionInfoNodeName('官网：https://example.com')).toBe(true)
    expect(isSubscriptionInfoNodeName('重置时间：明天 00:00')).toBe(true)
    expect(isSubscriptionInfoNodeName('Expire Date: 2026-12-31')).toBe(true)
    expect(isSubscriptionInfoNodeName('Plan Quota Total: 1024 GB')).toBe(true)
    expect(isSubscriptionInfoNodeName('倍率说明：高倍率节点会扣更多流量')).toBe(true)
    expect(isSubscriptionInfoNodeName('订阅更新：点击刷新')).toBe(true)
    expect(isSubscriptionInfoNodeName('官方地址：https://example.com')).toBe(true)
    expect(isSubscriptionInfoNodeName('Package Reset Time: tomorrow')).toBe(true)
    expect(isSubscriptionInfoNodeName('Remaining Traffic 50 GB')).toBe(true)
    expect(isSubscriptionInfoNodeName('🇭🇰 HK IEPL 2x')).toBe(false)
    expect(isSubscriptionInfoNodeName('US｜Los Angeles｜x1')).toBe(false)
    expect(isSubscriptionInfoNodeName('新加坡-流媒体')).toBe(false)
    expect(isSubscriptionInfoNodeName('香港 0.5x 家宽')).toBe(false)
  })

  it('should filter subscription info nodes, unsupported protocols, and incomplete protocol configs before refresh persistence', () => {
    const yaml = `
proxies:
    - { name: '剩余流量：111 GB', type: trojan, server: info.example.com, port: 443, password: pwd }
    - { name: '官网：https://example.com', type: trojan, server: info2.example.com, port: 443, password: pwd }
    - { name: '🇭🇰 HK 01', type: trojan, server: hk.example.com, port: 443, password: pwd }
    - { name: 'Unknown Protocol', type: unsupported-protocol, server: unknown.example.com, port: 443, password: pwd }
    - { name: 'Trojan Missing Password', type: trojan, server: missing.example.com, port: 443 }
    - { name: 'VMess Missing UUID', type: vmess, server: vmess.example.com, port: 443 }
proxy-groups:
    - { name: 'Upstream Auto', type: select, proxies: ['剩余流量：111 GB', '🇭🇰 HK 01', 'Unknown Protocol', 'Trojan Missing Password', 'VMess Missing UUID'] }
`
    const result = filterUsableParsedContent(parseClashYaml(yaml), parseClashGroups(yaml))

    expect(result.excludedCount).toBe(5)
    expect(result.nodes.map(node => node.name)).toEqual(['🇭🇰 HK 01'])
    expect(result.groups).toEqual([
      { name: 'Upstream Auto', type: 'select', memberNames: ['🇭🇰 HK 01'] },
    ])
  })

  it('should detect countries from flags and region codes in subscription node names', () => {
    const regionalYaml = `
proxies:
    - { name: '🇩🇪 [三网]DE 02', type: trojan, server: de.example.com, port: 443, password: pwd }
    - { name: '🇨🇦 [三网]CA 01', type: trojan, server: ca.example.com, port: 443, password: pwd }
    - { name: '🇭🇰 [三网]HK 01', type: anytls, server: hk.example.com, port: 443, password: pwd }
`
    const nodes = parseClashYaml(regionalYaml)

    expect(nodes).toHaveLength(3)
    expect(nodes.map(node => [node.name, node.countryCode, node.country])).toEqual([
      ['🇩🇪 [三网]DE 02', 'DE', 'Germany'],
      ['🇨🇦 [三网]CA 01', 'CA', 'Canada'],
      ['🇭🇰 [三网]HK 01', 'HK', 'Hong Kong'],
    ])
  })

  it('should detect countries from standalone region codes without flags', () => {
    expect(detectCountry('[三网]DE 02')).toEqual({ country: 'Germany', countryCode: 'DE' })
    expect(detectCountry('[三网]CA 01')).toEqual({ country: 'Canada', countryCode: 'CA' })
    expect(detectCountry('[三网]HK 01')).toEqual({ country: 'Hong Kong', countryCode: 'HK' })
  })

  it('should detect countries from Chinese aliases and city names', () => {
    expect(detectCountry('香港 IEPL 2x')).toEqual({ country: 'Hong Kong', countryCode: 'HK' })
    expect(detectCountry('日本 Osaka 03')).toEqual({ country: 'Japan', countryCode: 'JP' })
    expect(detectCountry('新加坡-流媒体')).toEqual({ country: 'Singapore', countryCode: 'SG' })
    expect(detectCountry('US｜Los Angeles｜x1')).toEqual({ country: 'United States', countryCode: 'US' })
    expect(detectCountry('美国 San Jose 01')).toEqual({ country: 'United States', countryCode: 'US' })
    expect(detectCountry('台湾 台北 01')).toEqual({ country: 'Taiwan', countryCode: 'TW' })
    expect(detectCountry('德国 法兰克福 01')).toEqual({ country: 'Germany', countryCode: 'DE' })
  })

  it('should detect traffic multipliers without matching normal node numbers', () => {
    expect(detectTrafficMultiplier('🇭🇰 HK IEPL 2x')).toEqual({ value: 2, label: '2x', high: true })
    expect(detectTrafficMultiplier('US｜Los Angeles｜x1')).toEqual({ value: 1, label: '1x', high: false })
    expect(detectTrafficMultiplier('日本 倍率: 0.5')).toEqual({ value: 0.5, label: '0.5x', high: false })
    expect(detectTrafficMultiplier('🇭🇰 HK 01')).toBeNull()
  })

  it('should attach multiplier tags to parsed subscription nodes', () => {
    const yaml = `
proxies:
    - { name: '🇭🇰 HK IEPL 2x', type: trojan, server: hk.example.com, port: 443, password: pwd }
    - { name: '🇺🇸 US 01', type: trojan, server: us.example.com, port: 443, password: pwd }
`
    const nodes = parseClashYaml(yaml)

    expect(nodes.find(node => node.name === '🇭🇰 HK IEPL 2x')?.tags).toEqual([
      'multiplier:2x',
      'high-multiplier',
    ])
    expect(nodes.find(node => node.name === '🇺🇸 US 01')?.tags).toEqual([])
  })

  it('should attach streaming, unlock, residential, and native-ip tags to parsed nodes', () => {
    const yaml = `
proxies:
    - { name: '🇭🇰 Netflix 解锁 2x', type: trojan, server: hk.example.com, port: 443, password: pwd }
    - { name: '🇺🇸 US Residential Native', type: trojan, server: us.example.com, port: 443, password: pwd }
    - { name: '🇯🇵 JP 普通节点', type: trojan, server: jp.example.com, port: 443, password: pwd }
`
    const nodes = parseClashYaml(yaml)

    expect(nodes.find(node => node.name === '🇭🇰 Netflix 解锁 2x')?.tags).toEqual([
      'multiplier:2x',
      'high-multiplier',
      'streaming',
      'unlock',
    ])
    expect(nodes.find(node => node.name === '🇺🇸 US Residential Native')?.tags).toEqual([
      'residential',
      'native-ip',
    ])
    expect(nodes.find(node => node.name === '🇯🇵 JP 普通节点')?.tags).toEqual([])
  })

  it('should handle edge cases with YAML parser', () => {
    const edgeCasesYaml = `
proxies:
    # Comments should be ignored
    - { name: "Node's Name", type: trojan, server: server.com, port: 443, password: pwd }
    - name: "Name: with: colons"
      type: vmess
      server: example.com
      port: 443
      uuid: 12345678-1234-1234-1234-123456789012
    - { name: '包含{括号}的', type: ss, server: test.com, port: 8388, cipher: aes-256-gcm, password: pwd }
`
    const nodes = parseClashYaml(edgeCasesYaml)
    expect(nodes.length).toBe(3)
    expect(nodes[0]!.name).toBe("Node's Name")
    expect(nodes[1]!.name).toBe("Name: with: colons")
    expect(nodes[2]!.name).toBe('包含{括号}的')
  })

  it('should handle invalid YAML gracefully', () => {
    const invalidYaml = `
proxies:
    - { name: 'Unclosed bracket', type: trojan, server: test.com, port: 443
`
    const nodes = parseClashYaml(invalidYaml)
    // Should return empty array instead of throwing
    expect(Array.isArray(nodes)).toBe(true)
  })

  it('caches fetched raw subscription content before parse validation fails', async () => {
    const db = createRefreshMockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'subscription-userinfo' ? 'upload=10; download=20; total=100; expire=1893456000' : null },
      text: async () => 'this is not a supported proxy subscription yet',
    })))

    await expect(refreshSourceById(db, 'source-1')).rejects.toMatchObject({
      message: expect.stringContaining('No usable proxy nodes parsed'),
      status: 422,
    } satisfies Partial<SourceRefreshError>)

    expect(db.operations).toContainEqual({
      operation: 'cache-raw-content',
      rawContent: 'this is not a supported proxy subscription yet',
      uploadBytes: 10,
      downloadBytes: 20,
      totalBytes: 100,
      expireTime: 1893456000,
      id: 'source-1',
    })
  })

  it('explicitly deletes source nodes before deleting the source', async () => {
    const db = createDeleteMockDb(true)

    await expect(deleteSourceById(db, 'source-1', '2026-01-01T00:00:00.000Z')).resolves.toBe(true)

    expect(db.operations).toEqual([
      { operation: 'delete-nodes', sourceId: 'source-1' },
      { operation: 'delete-source', sourceId: 'source-1' },
    ])
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, '2026-01-01T00:00:00.000Z')
  })

  it('does not initialize defaults when deleting a missing source', async () => {
    const db = createDeleteMockDb(false)

    await expect(deleteSourceById(db, 'missing-source', '2026-01-01T00:00:00.000Z')).resolves.toBe(false)

    expect(db.operations).toEqual([])
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('initializes zero-setup defaults after refreshing a subscription source', async () => {
    const db = createRefreshMockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => `
proxies:
  - { name: '🇭🇰 HK 01', type: trojan, server: hk.example.com, port: 443, password: pwd }
`,
    })))

    await expect(refreshSourceById(db, 'source-1')).resolves.toMatchObject({
      success: true,
      addedCount: 1,
      nodeCount: 1,
      format: 'mihomo',
    })

    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'insert-node',
      sourceId: 'source-1',
      name: '🇭🇰 HK 01',
      protocol: 'trojan',
      server: 'hk.example.com',
      port: 443,
      country: 'Hong Kong',
      countryCode: 'HK',
    }))
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('updates a stable subscription node when its server changes instead of replacing its row', async () => {
    const db = createRefreshUpdateMockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us-new.example.com, port: 443, password: pwd-new }
`,
    })))

    await expect(refreshSourceById(db, 'source-1')).resolves.toMatchObject({
      success: true,
      addedCount: 0,
      updatedCount: 1,
      removedCount: 0,
    })

    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'update-node',
      id: 'node-us',
      name: '🇺🇸 US 01',
      server: 'us-new.example.com',
      port: 443,
    }))
    expect(db.operations).not.toContainEqual(expect.objectContaining({ operation: 'insert-node' }))
    expect(db.operations).not.toContainEqual(expect.objectContaining({ operation: 'delete-node' }))
  })

  it('syncs imported upstream source group node ids after subscription refresh', async () => {
    const db = createRefreshSourceGroupSyncMockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us-new.example.com, port: 443, password: pwd-new }
  - { name: '🇯🇵 JP 01', type: trojan, server: jp.example.com, port: 443, password: pwd }
  - { name: 'Disabled 01', type: trojan, server: disabled-new.example.com, port: 443, password: pwd-new }
proxy-groups:
  - { name: 'Upstream Auto', type: url-test, proxies: ['🇺🇸 US 01', '🇯🇵 JP 01', 'Disabled 01'] }
`,
    })))

    await expect(refreshSourceById(db, 'source-1')).resolves.toMatchObject({
      success: true,
      addedCount: 1,
      updatedCount: 2,
      removedCount: 0,
      sourceGroupCount: 1,
    })

    const collectionUpdate = db.operations.find((item) => item.operation === 'update-collection-node-ids')
    expect(collectionUpdate).toBeDefined()
    expect(JSON.parse(String(collectionUpdate?.nodeIds))).toEqual(['node-us', expect.any(String)])
    expect(JSON.parse(String(collectionUpdate?.nodeIds))).not.toContain('node-disabled')
    expect(db.operations).not.toContainEqual(expect.objectContaining({
      operation: 'prepare',
      sql: expect.stringContaining('collections WHERE notes LIKE'),
    }))
  })

  it('initializes zero-setup defaults after a subscription refresh failure', async () => {
    const db = createRefreshMockDb()
    const rawContent = 'not a usable proxy subscription'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'subscription-userinfo' ? 'upload=1; download=2; total=3; expire=1893456000' : null },
      text: async () => rawContent,
    })))

    const response = await sourcesApp.request('/source-1/refresh', {
      method: 'POST',
    }, { DB: db })
    const payload = await response.json() as { success: boolean; error: string }

    expect(response.status).toBe(422)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('No usable proxy nodes parsed')
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'record-refresh-error',
      id: 'source-1',
      error: expect.stringContaining('No usable proxy nodes parsed'),
    }))
    expect(db.operations).toContainEqual({
      operation: 'cache-raw-content',
      rawContent,
      uploadBytes: 1,
      downloadBytes: 2,
      totalBytes: 3,
      expireTime: 1893456000,
      id: 'source-1',
    })
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('initializes zero-setup defaults after creating a subscription source', async () => {
    const db = createCreateMockDb()

    const response = await sourcesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'url',
        url: 'https://airport.example/sub',
        format: 'auto',
        refreshAfterCreate: false,
      }),
    }, { DB: db })
    const payload = await response.json() as { success: boolean; data: { source: { name: string } } }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.source.name).toBe('airport.example')
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('defaults source type to url when creating with only a subscription URL', async () => {
    const db = createCreateMockDb()

    const response = await sourcesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://only-url.example/sub',
        refreshAfterCreate: false,
      }),
    }, { DB: db })
    const payload = await response.json() as {
      success: boolean;
      data: { source: { name: string; type: string; url: string } };
    }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.source).toMatchObject({
      name: 'only-url.example',
      type: 'url',
      url: 'https://only-url.example/sub',
    })
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('refreshes a subscription source by default when creating it with only a URL', async () => {
    const db = createCreateRefreshMockDb()
    const rawContent = `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us.example.com, port: 443, password: pwd }
proxy-groups:
  - { name: 'US Auto', type: url-test, proxies: ['🇺🇸 US 01'] }
`
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'subscription-userinfo' ? 'upload=10; download=20; total=100; expire=1893456000' : null },
      text: async () => rawContent,
    })))

    const response = await sourcesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://airport.example/sub',
      }),
    }, { DB: db })
    const payload = await response.json() as {
      success: boolean;
      data: {
        source: {
          type: string;
          url: string;
          rawContent?: string;
          groups: Array<{ name: string; type: string; memberNames: string[] }>;
          uploadBytes?: number;
          downloadBytes?: number;
          totalBytes?: number;
          expireTime?: number;
        };
        refresh: SourceRefreshResult;
      };
    }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.source).toMatchObject({
      type: 'url',
      url: 'https://airport.example/sub',
    })
    expect(payload.data.refresh).toMatchObject({
      success: true,
      addedCount: 1,
      nodeCount: 1,
      format: 'mihomo',
      sourceGroupCount: 1,
    })
    expect(payload.data.source.rawContent).toBe(rawContent)
    expect(payload.data.source.groups).toEqual([
      { name: 'US Auto', type: 'url-test', memberNames: ['🇺🇸 US 01'] },
    ])
    expect(payload.data.source).toMatchObject({
      uploadBytes: 10,
      downloadBytes: 20,
      totalBytes: 100,
      expireTime: 1893456000,
    })
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'insert-node',
      name: '🇺🇸 US 01',
      server: 'us.example.com',
      countryCode: 'US',
    }))
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('imports a clipboard source from pasted Clash YAML content', async () => {
    const db = createCreateRefreshMockDb()
    const rawContent = `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us.example.com, port: 443, password: pwd }
proxy-groups:
  - { name: 'US Auto', type: url-test, proxies: ['🇺🇸 US 01'] }
`

    const response = await sourcesApp.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pasted Config', content: rawContent }),
    }, { DB: db })
    const payload = await response.json() as {
      success: boolean;
      data: {
        source: { type: string; url?: string; name: string; rawContent?: string };
        refresh: SourceRefreshResult;
        refreshError?: string;
      };
    }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.source).toMatchObject({ type: 'clipboard', name: 'Pasted Config' })
    expect(payload.data.source.url).toBeUndefined()
    expect(payload.data.refresh).toMatchObject({
      success: true,
      addedCount: 1,
      nodeCount: 1,
      format: 'mihomo',
      sourceGroupCount: 1,
    })
    expect(payload.data.refreshError).toBeUndefined()
    expect(payload.data.source.rawContent).toBe(rawContent.trim())
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'insert-node',
      name: '🇺🇸 US 01',
      server: 'us.example.com',
      countryCode: 'US',
    }))
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('defaults the import name and preserves raw content when no usable nodes are parsed', async () => {
    const db = createCreateRefreshMockDb()

    const response = await sourcesApp.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'not a usable proxy config' }),
    }, { DB: db })
    const payload = await response.json() as {
      success: boolean;
      data: {
        source: { name: string; rawContent?: string; lastRefreshError?: string };
        refresh?: SourceRefreshResult;
        refreshError?: string;
      };
    }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.source.name).toBe('Imported Config')
    expect(payload.data.source.rawContent).toBe('not a usable proxy config')
    expect(payload.data.refresh).toBeUndefined()
    expect(payload.data.refreshError).toContain('No usable proxy nodes parsed')
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'record-refresh-error',
      error: expect.stringContaining('No usable proxy nodes parsed'),
    }))
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('rejects importing with empty content', async () => {
    const db = createCreateMockDb()

    const response = await sourcesApp.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    }, { DB: db })
    const payload = await response.json() as { success: boolean; error: string }

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('content is required')
  })
})

function makeSsrUri(input: {
  server: string;
  port: number;
  method: string;
  password: string;
  protocol: string;
  obfs: string;
  name: string;
  obfsParam?: string;
  protocolParam?: string;
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

function createRefreshMockDb(): D1Database & { operations: Array<Record<string, unknown>> } {
  const operations: Array<Record<string, unknown>> = []
  return {
    operations,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM sources WHERE id = ?')) {
            return {
              id: args[0],
              url: 'https://example.com/sub',
              format: 'auto',
              user_agent: null,
            }
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO nodes')) {
            operations.push({
              operation: 'insert-node',
              id: args[0],
              sourceId: args[1],
              name: args[2],
              protocol: args[3],
              server: args[4],
              port: args[5],
              country: args[6],
              countryCode: args[7],
              tags: args[8],
              rawConfig: args[9],
              parsedConfig: args[10],
            })
          }
          if (sql.includes('raw_content = ?')) {
            operations.push({
              operation: 'cache-raw-content',
              rawContent: args[0],
              uploadBytes: args[1],
              downloadBytes: args[2],
              totalBytes: args[3],
              expireTime: args[4],
              id: args[6],
            })
          }
          if (sql.includes('last_refresh_error = ?')) {
            operations.push({
              operation: 'record-refresh-error',
              error: args[0],
              id: args[2],
            })
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => {
        return { results: [] }
      },
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}

function createRefreshUpdateMockDb(): D1Database & { operations: Array<Record<string, unknown>> } {
  const operations: Array<Record<string, unknown>> = []
  const existingRows = [{
    id: 'node-us',
    name: '🇺🇸 US 01',
    server: 'us-old.example.com',
    port: 443,
    protocol: 'trojan',
    country: 'United States',
    country_code: 'US',
    tags: '[]',
    raw_config: JSON.stringify({ name: '🇺🇸 US 01', type: 'trojan', server: 'us-old.example.com', port: 443, password: 'pwd-old' }),
    parsed_config: JSON.stringify({ protocol: 'trojan', server: 'us-old.example.com', port: 443, password: 'pwd-old', extra: { password: 'pwd-old' } }),
  }]
  return {
    operations,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM sources WHERE id = ?')) {
            return {
              id: args[0],
              url: 'https://example.com/sub',
              format: 'auto',
              user_agent: null,
            }
          }
          return null
        },
        all: async () => {
          if (sql.includes('FROM nodes WHERE source_id = ? AND is_manual = 0')) return { results: existingRows }
          if (sql.includes('SELECT COUNT(*) as cnt FROM nodes WHERE source_id = ?')) return { results: [{ cnt: 1 }] }
          return { results: [] }
        },
        run: async () => {
          if (sql.includes('INSERT INTO nodes')) {
            operations.push({ operation: 'insert-node', id: args[0], name: args[2] })
          }
          if (sql.includes('UPDATE nodes SET')) {
            operations.push({
              operation: 'update-node',
              name: args[0],
              protocol: args[1],
              server: args[2],
              port: args[3],
              id: args[10],
            })
          }
          if (sql.includes('DELETE FROM nodes WHERE id = ?')) {
            operations.push({ operation: 'delete-node', id: args[0] })
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}

function createRefreshSourceGroupSyncMockDb(): D1Database & { operations: Array<Record<string, unknown>> } {
  const operations: Array<Record<string, unknown>> = []
  const nodes = [{
    id: 'node-us',
    name: '🇺🇸 US 01',
    enabled: 1,
    server: 'us-old.example.com',
    port: 443,
    protocol: 'trojan',
    country: 'United States',
    country_code: 'US',
    tags: '[]',
    raw_config: JSON.stringify({ name: '🇺🇸 US 01', type: 'trojan', server: 'us-old.example.com', port: 443, password: 'pwd-old' }),
    parsed_config: JSON.stringify({ protocol: 'trojan', server: 'us-old.example.com', port: 443, password: 'pwd-old', extra: { password: 'pwd-old' } }),
  }, {
    id: 'node-disabled',
    name: 'Disabled 01',
    enabled: 0,
    server: 'disabled.example.com',
    port: 443,
    protocol: 'trojan',
    country: '',
    country_code: '',
    tags: '[]',
    raw_config: JSON.stringify({ name: 'Disabled 01', type: 'trojan', server: 'disabled.example.com', port: 443, password: 'pwd' }),
    parsed_config: JSON.stringify({ protocol: 'trojan', server: 'disabled.example.com', port: 443, password: 'pwd', extra: { password: 'pwd' } }),
  }]
  const collection = {
    id: 'collection-upstream',
    node_ids: JSON.stringify(['node-us']),
    notes: makeSourceNodeGroupMarker('source-1', 'Upstream Auto'),
  }

  const db = {
    operations,
    batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => {
      for (const statement of statements) await statement.run()
      return []
    }),
    prepare: vi.fn((sql: string) => {
      operations.push({ operation: 'prepare', sql })
      return {
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM sources WHERE id = ?')) {
            return {
              id: args[0],
              url: 'https://example.com/sub',
              format: 'auto',
              user_agent: null,
            }
          }
          return null
        },
        all: async () => {
          if (sql.includes('SELECT id, name, server, port, protocol')) return { results: nodes }
          if (sql.includes('SELECT COUNT(*) as cnt FROM nodes WHERE source_id = ?')) return { results: [{ cnt: nodes.length }] }
          if (sql.includes("SELECT id, node_ids, notes FROM collections WHERE notes IS NOT NULL AND notes != ''")) return { results: [collection] }
          if (sql.includes('SELECT id, name FROM nodes WHERE source_id = ? AND is_manual = 0 AND enabled = 1')) {
            return { results: nodes.filter(node => node.enabled !== 0).map(node => ({ id: node.id, name: node.name })) }
          }
          return { results: [] }
        },
        run: async () => {
          if (sql.includes('INSERT INTO nodes')) {
            nodes.push({
              id: String(args[0]),
              name: String(args[2]),
              enabled: 1,
              protocol: String(args[3]),
              server: String(args[4]),
              port: Number(args[5]),
              country: String(args[6] ?? ''),
              country_code: String(args[7] ?? ''),
              tags: String(args[8]),
              raw_config: String(args[9]),
              parsed_config: String(args[10]),
            })
            operations.push({ operation: 'insert-node', id: args[0], name: args[2] })
          }
          if (sql.includes('UPDATE nodes SET')) {
            const node = nodes.find(item => item.id === args[10])
            if (node) {
              node.name = String(args[0])
              node.protocol = String(args[1])
              node.server = String(args[2])
              node.port = Number(args[3])
              node.country = String(args[4] ?? '')
              node.country_code = String(args[5] ?? '')
              node.tags = String(args[6])
              node.raw_config = String(args[7])
              node.parsed_config = String(args[8])
            }
            operations.push({ operation: 'update-node', id: args[10], server: args[2] })
          }
          if (sql.includes('UPDATE collections SET node_ids = ?')) {
            collection.node_ids = String(args[0])
            operations.push({
              operation: 'update-collection-node-ids',
              nodeIds: args[0],
              id: args[2],
            })
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => {
        if (sql.includes("SELECT id, node_ids, notes FROM collections WHERE notes IS NOT NULL AND notes != ''")) return { results: [collection] }
        return { results: [] }
      },
      run: async () => ({ success: true }),
      raw: async () => [],
    }}),
  }
  return db as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}

function createDeleteMockDb(hasSource: boolean): D1Database & { operations: Array<Record<string, unknown>> } {
  const operations: Array<Record<string, unknown>> = []
  return {
    operations,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT id FROM sources WHERE id = ?')) {
            return hasSource ? { id: args[0] } : null
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('DELETE FROM nodes WHERE source_id = ?')) {
            operations.push({ operation: 'delete-nodes', sourceId: args[0] })
          }
          if (sql.includes('DELETE FROM sources WHERE id = ?')) {
            operations.push({ operation: 'delete-source', sourceId: args[0] })
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}

function createCreateMockDb(): D1Database {
  const inserted: Record<string, unknown> = {}
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM sources WHERE id = ?')) {
            return {
              id: args[0],
              name: inserted.name ?? 'airport.example',
              type: inserted.type ?? 'url',
              url: 'url' in inserted ? inserted.url : 'https://airport.example/sub',
              format: inserted.format ?? 'auto',
              enabled: 1,
              node_count: 0,
              last_updated: null,
              last_refresh_error: null,
              update_interval: 0,
              user_agent: null,
              notes: null,
              tags: '[]',
              source_groups: '[]',
              upload_bytes: null,
              download_bytes: null,
              total_bytes: null,
              expire_time: null,
              created_at: inserted.created_at ?? '2026-01-01T00:00:00.000Z',
              updated_at: inserted.updated_at ?? '2026-01-01T00:00:00.000Z',
            }
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO sources')) {
            inserted.id = args[0]
            inserted.name = args[1]
            inserted.type = args[2]
            inserted.url = args[3]
            inserted.format = args[4]
            inserted.created_at = args[10]
            inserted.updated_at = args[11]
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database
}

function createCreateRefreshMockDb(): D1Database & { operations: Array<Record<string, unknown>> } {
  const operations: Array<Record<string, unknown>> = []
  const inserted: Record<string, unknown> = {}
  return {
    operations,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM sources WHERE id = ?')) {
            return {
              id: args[0],
              name: inserted.name ?? 'airport.example',
              type: inserted.type ?? 'url',
              url: 'url' in inserted ? inserted.url : 'https://airport.example/sub',
              format: inserted.format ?? 'auto',
              enabled: 1,
              node_count: inserted.node_count ?? operations.filter(item => item.operation === 'insert-node').length,
              last_updated: inserted.last_updated ?? null,
              last_refresh_error: null,
              update_interval: 0,
              user_agent: null,
              notes: null,
              tags: '[]',
              source_groups: inserted.source_groups ?? '[]',
              raw_content: inserted.raw_content ?? null,
              upload_bytes: inserted.upload_bytes ?? null,
              download_bytes: inserted.download_bytes ?? null,
              total_bytes: inserted.total_bytes ?? null,
              expire_time: inserted.expire_time ?? null,
              created_at: inserted.created_at ?? '2026-01-01T00:00:00.000Z',
              updated_at: inserted.updated_at ?? '2026-01-01T00:00:00.000Z',
            }
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO sources')) {
            inserted.id = args[0]
            inserted.name = args[1]
            inserted.type = args[2]
            inserted.url = args[3]
            inserted.format = args[4]
            inserted.created_at = args[10]
            inserted.updated_at = args[11]
          }
          if (sql.includes('INSERT INTO nodes')) {
            operations.push({
              operation: 'insert-node',
              id: args[0],
              sourceId: args[1],
              name: args[2],
              protocol: args[3],
              server: args[4],
              port: args[5],
              country: args[6],
              countryCode: args[7],
            })
          }
          if (sql.includes('UPDATE sources SET') && sql.includes('node_count = ?')) {
            inserted.node_count = args[0]
            inserted.last_updated = args[1]
            inserted.upload_bytes = args[2]
            inserted.download_bytes = args[3]
            inserted.total_bytes = args[4]
            inserted.expire_time = args[5]
            inserted.source_groups = args[6]
            inserted.raw_content = args[7]
            inserted.updated_at = args[8]
          } else if (sql.includes('raw_content = ?')) {
            inserted.raw_content = args[0]
            inserted.upload_bytes = args[1]
            inserted.download_bytes = args[2]
            inserted.total_bytes = args[3]
            inserted.expire_time = args[4]
            inserted.updated_at = args[5]
          } else if (sql.includes('last_refresh_error = ?')) {
            operations.push({ operation: 'record-refresh-error', error: args[0], id: args[2] })
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}
