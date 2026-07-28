import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import type { ProxyGroup, ProxyNode, ProxyRule } from '@uni-conf/types'
import { getRuleCompatibilityLevel, RULE_COMPATIBILITY } from '@uni-conf/shared'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'
import {
  generateEgern,
  generateQuantumultX,
  generateShadowrocket,
  generateStashYaml,
  generateSurge,
} from './client-configs'
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

const wireguardNode: ProxyNode = {
  ...ssNode,
  id: 'node-wireguard-singbox',
  name: 'US WireGuard',
  protocol: 'wireguard',
  server: 'wg.example.com',
  port: 51820,
  parsedConfig: {
    protocol: 'wireguard',
    server: 'wg.example.com',
    port: 51820,
    extra: {
      privateKey: 'private-key',
      publicKey: 'peer-key',
      presharedKey: 'psk',
      ip: '172.16.0.2/32',
    },
  },
}

const nativeWireGuardEndpointNode: ProxyNode = {
  ...wireguardNode,
  id: 'node-native-wireguard-endpoint',
  name: 'Renamed WireGuard',
  server: 'primary-current.example.com',
  port: 51822,
  rawConfig: {
    type: 'wireguard',
    tag: 'Original WireGuard',
    address: ['172.16.0.2/32'],
    private_key: 'imported-private-key',
    mtu: 1380,
    peers: [
      {
        address: 'primary-imported.example.com',
        port: 51820,
        public_key: 'imported-primary-key',
        allowed_ips: ['0.0.0.0/0'],
        persistent_keepalive_interval: 30,
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
      address: ['172.16.0.3/32'],
      allowedIPs: ['0.0.0.0/0', '::/0'],
    },
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

const anytlsFingerprintNode: ProxyNode = {
  ...anytlsNode,
  id: 'node-anytls-fp',
  name: 'HK AnyTLS FP',
  parsedConfig: {
    ...anytlsNode.parsedConfig,
    extra: {
      fingerprint: 'safari',
      alpn: 'h3,h2',
    },
  },
}

const ssrNode: ProxyNode = {
  ...ssNode,
  id: 'node-ssr',
  name: 'HK SSR',
  protocol: 'ssr',
  server: 'hk.example.com',
  port: 443,
  parsedConfig: {
    protocol: 'ssr',
    server: 'hk.example.com',
    port: 443,
    password: 'secret',
    extra: {
      method: 'aes-256-cfb',
      protocol: 'auth_sha1_v4',
      obfs: 'tls1.2_ticket_auth',
      protocolParam: '32',
      obfsParam: 'cdn.example.com',
    },
  },
}

const hysteriaNode: ProxyNode = {
  ...ssNode,
  id: 'node-hysteria',
  name: 'SG Hysteria',
  protocol: 'hysteria',
  server: 'sg.example.com',
  port: 443,
  parsedConfig: {
    protocol: 'hysteria',
    server: 'sg.example.com',
    port: 443,
    password: 'auth-secret',
    sni: 'sg.example.com',
    skipCertVerify: true,
    extra: {
      protocol: 'udp',
      upMbps: 80,
      downMbps: 120,
    },
  },
}

const hysteria2Node: ProxyNode = {
  ...ssNode,
  id: 'node-hysteria2',
  name: 'JP Hysteria2',
  protocol: 'hysteria2',
  server: 'hy2.example.com',
  port: 443,
  parsedConfig: {
    protocol: 'hysteria2',
    server: 'hy2.example.com',
    port: 443,
    password: 'hy2-secret',
    sni: 'hy2.example.com',
    extra: {
      obfs: 'salamander',
      obfsPassword: 'obfs-secret',
    },
  },
}

const vlessRealityNode: ProxyNode = {
  ...ssNode,
  id: 'node-vless-reality',
  name: 'US VLESS Reality',
  protocol: 'vless',
  server: 'reality.example.com',
  port: 443,
  parsedConfig: {
    protocol: 'vless',
    server: 'reality.example.com',
    port: 443,
    uuid: '12345678-1234-1234-1234-123456789012',
    tls: true,
    sni: 'www.example.com',
    extra: {
      security: 'reality',
      flow: 'xtls-rprx-vision',
      publicKey: 'reality-public-key',
      shortId: 'abcd',
    },
  },
}

const vmessNode: ProxyNode = {
  ...ssNode,
  id: 'node-vmess',
  name: 'US VMess',
  protocol: 'vmess',
  server: 'vmess.example.com',
  port: 443,
  parsedConfig: {
    protocol: 'vmess',
    server: 'vmess.example.com',
    port: 443,
    uuid: '12345678-1234-1234-1234-123456789012',
    tls: true,
    extra: {
      alterId: 0,
      cipher: 'aes-128-gcm',
    },
  },
}

const nativeMihomoNode: ProxyNode = {
  ...ssNode,
  id: 'node-native-mihomo',
  name: 'Renamed Mihomo SS',
  server: 'new-mihomo.example.com',
  port: 8389,
  rawConfig: {
    mihomo: {
      name: 'Original Mihomo SS',
      type: 'ss',
      server: 'old-mihomo.example.com',
      port: 8388,
      cipher: '2022-blake3-aes-128-gcm',
      password: 'password',
      udp: true,
      'plugin-opts': { mode: 'websocket', host: 'plugin.example.com' },
    },
  },
}

const nativeSingboxNode: ProxyNode = {
  ...ssNode,
  id: 'node-native-singbox',
  name: 'Renamed sing-box SS',
  server: 'new-singbox.example.com',
  port: 8390,
  rawConfig: {
    singbox: {
      type: 'shadowsocks',
      tag: 'Original sing-box SS',
      server: 'old-singbox.example.com',
      server_port: 8388,
      method: '2022-blake3-aes-128-gcm',
      password: 'password',
      multiplex: { enabled: true },
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

const proxyGroup: ProxyGroup = {
  ...autoGroup,
  id: 'builtin-proxy',
  name: 'PROXY',
  type: 'select',
  collectionIds: [],
  groupIds: ['group-auto'],
  isBuiltin: true,
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
  it('uses the default smart client baseline for Mihomo configs', () => {
    const content = generateMihomoYaml([], [], [], [])

    expect(content).toContain('mixed-port: 7890')
    expect(content).toContain('allow-lan: false')
    expect(content).toContain('mode: rule')
    expect(content).toContain('log-level: warning')
    expect(content).not.toContain('socks-port:')
    expect(content).not.toContain('redir-port:')
  })

  it('uses FakeIP with split DNS by default for Mihomo configs', () => {
    const content = generateMihomoYaml([], [], [], [])

    expect(content).toContain('enhanced-mode: fake-ip')
    expect(content).toContain('fallback-filter:')
    expect(content).toContain('nameserver-policy:')
    expect(content).toContain('fake-ip-range:')
    expect(content).toContain('- "rule-set:uni-conf-fake-ip-filter"')
    expect(content).toContain('format: mrs')
    expect(content).not.toContain('RULE-SET,uni-conf-fake-ip-filter')
  })

  it('keeps FakeIP enabled when DNS upstream routing changes', () => {
    const single = generateMihomoYaml(
      [],
      [],
      [],
      [],
      {},
      {
        dnsPolicy: {
          additionalRealIpDomains: [],
          resolutionMode: 'single',
        },
      },
    )
    const fakeIp = generateMihomoYaml([], [], [], [])

    expect(single).toContain('enhanced-mode: fake-ip')
    expect(single).not.toContain('fallback-filter:')
    expect(fakeIp).toContain('enhanced-mode: fake-ip')
    expect(fakeIp).toContain('fake-ip-filter:')
  })

  it('renders sing-box FakeIP as a modern DNS server', () => {
    const fakeIp = JSON.parse(generateSingboxJson([], [], [], [])) as {
      log: Record<string, unknown>
      dns: { servers: Array<Record<string, unknown>>; rules: Array<Record<string, unknown>> }
      inbounds: Array<Record<string, unknown>>
      route: { default_domain_resolver: string; rule_set: Array<Record<string, unknown>> }
      experimental: { cache_file: { store_fakeip: boolean } }
    }
    const single = JSON.parse(
      generateSingboxJson(
        [],
        [],
        [],
        [],
        {},
        {
          dnsPolicy: {
            additionalRealIpDomains: [],
            resolutionMode: 'single',
          },
        },
      ),
    ) as {
      dns: { servers: Array<{ tag: string }>; rules?: unknown; final: string }
    }

    expect(fakeIp.log).toMatchObject({ level: 'warn', timestamp: true })
    expect(fakeIp.inbounds).toContainEqual(
      expect.objectContaining({
        type: 'tun',
        tag: 'tun-in',
        auto_route: true,
        strict_route: true,
      }),
    )
    expect(fakeIp.inbounds).toContainEqual(
      expect.objectContaining({
        type: 'mixed',
        tag: 'mixed-in',
        listen: '::',
        listen_port: 2080,
        set_system_proxy: false,
      }),
    )
    expect(fakeIp.experimental.cache_file.store_fakeip).toBe(true)
    expect(fakeIp.dns.servers).toContainEqual(
      expect.objectContaining({
        type: 'fakeip',
        tag: 'fakeip',
      }),
    )
    expect(fakeIp.dns.rules).toContainEqual(
      expect.objectContaining({
        rule_set: 'uni-conf-fake-ip-filter',
        action: 'route',
        server: 'localDns',
      }),
    )
    expect(fakeIp.dns.rules).toContainEqual(
      expect.objectContaining({
        query_type: ['A', 'AAAA'],
        action: 'route',
        server: 'fakeip',
      }),
    )
    expect(fakeIp.dns.rules.findIndex((rule) => rule.rule_set === 'geosite-cn')).toBeLessThan(
      fakeIp.dns.rules.findIndex((rule) => rule.server === 'fakeip'),
    )
    expect(fakeIp.route.default_domain_resolver).toBe('localDns')
    expect(fakeIp.route.rule_set).toContainEqual(
      expect.objectContaining({
        tag: 'uni-conf-fake-ip-filter',
        type: 'remote',
        format: 'binary',
      }),
    )
    expect(single.dns.servers).toContainEqual(expect.objectContaining({ tag: 'fakeip' }))
    expect(single.dns.rules).toContainEqual(expect.objectContaining({ server: 'fakeip' }))
    expect(single.dns.final).toBe('localDns')
    expect(fakeIp.experimental.cache_file.store_fakeip).toBe(true)
  })

  it('renders baseline runtime sections for text based full-config clients', () => {
    const rows = [toRow(proxyGroup), toRow(autoGroup)]
    const nodeRows = [toNodeRow(ssNode)]
    const collectionNodeNames = { 'collection-auto': [ssNode.name] }

    const loon = generateLoon(nodeRows, rows, [], [], collectionNodeNames)
    expect(loon).toContain('[General]')
    expect(loon).toContain('ip-mode = v4-only')
    expect(loon).toContain('dns-server = system, 119.29.29.29, 223.5.5.5')
    expect(loon).toContain('*.lan')
    expect(loon).toContain('wifi-access-http-port = 7222')
    expect(loon).toContain('proxy-test-url = http://www.gstatic.com/generate_204')
    expect(loon).toContain(
      'Auto = url-latency-benchmark, Supported SS, url=http://www.gstatic.com/generate_204, interval=300',
    )
    expect(loon).toContain('[Proxy Group]')
    expect(loon).toContain('FINAL, PROXY')

    const surge = generateSurge(nodeRows, rows, [], [], collectionNodeNames)
    expect(surge).toContain('[General]')
    expect(surge).toContain('loglevel = notify')
    expect(surge).toContain('internet-test-url = http://connectivitycheck.gstatic.com/generate_204')
    expect(surge).toContain('[Proxy Group]')
    expect(surge).toContain('FINAL,PROXY')

    const shadowrocket = generateShadowrocket(nodeRows, rows, [], [], collectionNodeNames)
    expect(shadowrocket).toContain('[General]')
    expect(shadowrocket).toContain('bypass-system = true')
    expect(shadowrocket).toContain('dns-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query')
    expect(shadowrocket).toContain('*.lan')
    expect(shadowrocket).toContain('[Host]\n*.cn = server:223.5.5.5')
    expect(shadowrocket).toContain('[Proxy Group]')
    expect(shadowrocket).toContain('FINAL,PROXY')

    const quantumultx = generateQuantumultX(nodeRows, rows, [], [], collectionNodeNames)
    expect(quantumultx).toContain('[general]')
    expect(quantumultx).toContain('server_check_url=http://www.gstatic.com/generate_204')
    expect(quantumultx).toContain(
      'url-latency-benchmark=Auto, Supported SS, url=http://www.gstatic.com/generate_204, interval=300',
    )
    expect(quantumultx).toContain('[policy]')
    expect(quantumultx).toContain('FINAL,PROXY')

    const egern = yaml.load(generateEgern(nodeRows, rows, [], [], collectionNodeNames)) as {
      auto_update: { interval: number }
      ipv6: boolean
      http_port: number
      socks_port: number
      policy_groups: Array<Record<string, { name: string }>>
      rules: Array<Record<string, unknown>>
    }
    expect(egern.auto_update.interval).toBe(86400)
    expect(egern.ipv6).toBe(false)
    expect(egern.http_port).toBe(3080)
    expect(egern.socks_port).toBe(3081)
    expect(egern.policy_groups.map(egernEntryBody).map((group) => group?.name)).toContain(autoGroup.name)
    expect(egern.rules).toContainEqual({ default: { policy: 'PROXY' } })
  })

  it('renders split DNS and remote proxy resolution for Shadowrocket', () => {
    const rules = [
      {
        id: 'rule-proxy-domain',
        type: 'DOMAIN-SUFFIX',
        payload: 'google.com',
        target_group_id: proxyGroup.id,
        enabled: 1,
        no_resolve: 0,
      },
      {
        id: 'rule-direct-domain',
        type: 'DOMAIN-SUFFIX',
        payload: 'example.cn',
        target_group_id: directGroup.id,
        enabled: 1,
        no_resolve: 0,
      },
    ]
    const split = generateShadowrocket([], [toRow(proxyGroup), toRow(directGroup)], rules, [])
    const single = generateShadowrocket(
      [],
      [toRow(proxyGroup), toRow(directGroup)],
      rules,
      [],
      {},
      {
        dnsPolicy: {
          additionalRealIpDomains: [],
          resolutionMode: 'single',
        },
      },
    )

    expect(split).toContain('dns-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query')
    expect(split).toContain('[Host]\n*.cn = server:223.5.5.5')
    expect(split).toContain('DOMAIN-SUFFIX,google.com,PROXY,force-remote-dns')
    expect(split).toContain('DOMAIN-SUFFIX,example.cn,DIRECT')
    expect(split).not.toContain('DOMAIN-SUFFIX,example.cn,DIRECT,force-remote-dns')
    expect(single).toContain('dns-server = system, 223.5.5.5, 119.29.29.29')
    expect(single).not.toContain('[Host]')
    expect(single).not.toContain('force-remote-dns')
  })

  it('still appends text-client fallback rules when MATCH is disabled', () => {
    const rows = [toRow(proxyGroup), toRow(autoGroup)]
    const nodeRows = [toNodeRow(ssNode)]
    const disabledMatchRule = {
      id: 'rule-disabled-match',
      type: 'MATCH',
      payload: '',
      target_group_id: proxyGroup.id,
      enabled: 0,
      order: 100,
      no_resolve: 0,
    }

    expect(generateLoon(nodeRows, rows, [disabledMatchRule], [])).toContain('FINAL, PROXY')
    expect(generateSurge(nodeRows, rows, [disabledMatchRule], [])).toContain('FINAL,PROXY')
    expect(generateShadowrocket(nodeRows, rows, [disabledMatchRule], [])).toContain('FINAL,PROXY')
    expect(generateQuantumultX(nodeRows, rows, [disabledMatchRule], [])).toContain('FINAL,PROXY')

    const egern = yaml.load(generateEgern(nodeRows, rows, [disabledMatchRule], [])) as {
      rules: Array<Record<string, unknown>>
    }
    expect(egern.rules).toContainEqual({ default: { policy: 'PROXY' } })
  })

  it('uses an existing sing-box outbound for DNS and rule set downloads', () => {
    const withProxy = JSON.parse(generateSingboxJson([], [proxyGroup, autoGroup], [], [])) as {
      dns: { servers: Array<Record<string, unknown>> }
      route: { rule_set: Array<Record<string, unknown>> }
    }
    const withoutProxy = JSON.parse(generateSingboxJson([], [], [], [])) as {
      dns: { servers: Array<Record<string, unknown>> }
      route: { rule_set: Array<Record<string, unknown>> }
    }

    expect(withProxy.dns.servers.find((server) => server.tag === 'proxyDns')).toMatchObject({
      detour: 'PROXY',
    })
    expect(withProxy.route.rule_set.every((ruleSet) => ruleSet.download_detour === 'PROXY')).toBe(true)
    expect(withoutProxy.dns.servers.find((server) => server.tag === 'proxyDns')).toMatchObject({
      detour: 'direct',
    })
    expect(withoutProxy.route.rule_set.every((ruleSet) => ruleSet.download_detour === 'direct')).toBe(true)
  })

  it('uses the shared default health check settings for sing-box urltest groups', () => {
    const content = generateSingboxJson([ssNode], [autoGroup], [], [], {
      'collection-auto': [ssNode.name],
    })
    const config = JSON.parse(content) as { outbounds: Array<Record<string, unknown>> }
    const group = config.outbounds.find((outbound) => outbound.tag === autoGroup.name)

    expect(group).toMatchObject({
      type: 'urltest',
      url: 'http://www.gstatic.com/generate_204',
      interval: '300s',
      tolerance: 150,
    })
  })

  it('exports AnyTLS nodes for Mihomo preview configs', () => {
    const content = generateMihomoYaml([anytlsNode], [autoGroup], [], [], {
      'collection-auto': [anytlsNode.name],
    })

    expect(content).toContain('proxies:\n  - {name: "HK AnyTLS", type: anytls')
    expect(content).toContain('password: "secret"')
    expect(content).toContain('client-fingerprint: "chrome"')
    expect(content).toContain('alpn: ["h2", "http/1.1"]')
    expect(content).toContain('- "HK AnyTLS"')
  })

  it('exports AnyTLS TLS options for sing-box full configs', () => {
    const singbox = JSON.parse(generateSingboxJson([anytlsNode], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === anytlsNode.name)).toMatchObject({
      type: 'anytls',
      tag: 'HK AnyTLS',
      tls: {
        enabled: true,
        server_name: 'hk.example.com',
        utls: { enabled: true, fingerprint: 'chrome' },
        alpn: ['h2', 'http/1.1'],
      },
    })
  })

  it('exports AnyTLS fingerprint aliases for full configs', () => {
    const mihomo = generateMihomoYaml([anytlsFingerprintNode], [], [], [])
    expect(mihomo).toContain('client-fingerprint: "safari"')

    const singbox = JSON.parse(generateSingboxJson([anytlsFingerprintNode], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === anytlsFingerprintNode.name)).toMatchObject({
      type: 'anytls',
      tls: {
        utls: { enabled: true, fingerprint: 'safari' },
        alpn: ['h3', 'h2'],
      },
    })
  })

  it('exports VMess cipher fields for Mihomo and sing-box full configs', () => {
    const mihomo = generateMihomoYaml([vmessNode], [], [], [])
    expect(mihomo).toContain('type: vmess')
    expect(mihomo).toContain('cipher: aes-128-gcm')

    const singbox = JSON.parse(generateSingboxJson([vmessNode], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === vmessNode.name)).toMatchObject({
      type: 'vmess',
      security: 'aes-128-gcm',
    })
  })

  it('exports Hysteria2 obfs fields for Mihomo and sing-box full configs', () => {
    const mihomo = generateMihomoYaml([hysteria2Node], [], [], [])
    expect(mihomo).toContain('type: hysteria2')
    expect(mihomo).toContain('obfs: "salamander"')
    expect(mihomo).toContain('obfs-password: "obfs-secret"')

    const singbox = JSON.parse(generateSingboxJson([hysteria2Node], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === hysteria2Node.name)).toMatchObject({
      type: 'hysteria2',
      tag: 'JP Hysteria2',
      password: 'hy2-secret',
      obfs: {
        type: 'salamander',
        password: 'obfs-secret',
      },
    })
  })

  it('exports VLESS Reality fields from protocol registry form values', () => {
    const mihomo = generateMihomoYaml([vlessRealityNode], [], [], [])
    expect(mihomo).toContain('type: vless')
    expect(mihomo).toContain('reality-opts: {public-key: "reality-public-key", short-id: "abcd"}')

    const singbox = JSON.parse(generateSingboxJson([vlessRealityNode], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === vlessRealityNode.name)).toMatchObject({
      type: 'vless',
      tag: 'US VLESS Reality',
      uuid: '12345678-1234-1234-1234-123456789012',
      flow: 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: 'www.example.com',
        reality: {
          enabled: true,
          public_key: 'reality-public-key',
          short_id: 'abcd',
        },
      },
    })
  })

  it('exports ShadowsocksR nodes for Mihomo and omits them from sing-box', () => {
    const mihomo = generateMihomoYaml([ssrNode], [autoGroup], [], [], {
      'collection-auto': [ssrNode.name],
    })
    expect(mihomo).toContain('type: ssr')
    expect(mihomo).toContain('cipher: "aes-256-cfb"')
    expect(mihomo).toContain('protocol: "auth_sha1_v4"')
    expect(mihomo).toContain('obfs: "tls1.2_ticket_auth"')
    expect(mihomo).toContain('- "HK SSR"')

    const singbox = JSON.parse(
      generateSingboxJson([ssrNode], [autoGroup], [], [], { 'collection-auto': [ssrNode.name] }),
    ) as { outbounds: Array<Record<string, unknown>> }
    expect(singbox.outbounds.some((item) => item.tag === ssrNode.name)).toBe(false)
  })

  it('uses parsed Hysteria auth strings for Mihomo and sing-box full configs', () => {
    const mihomo = generateMihomoYaml([hysteriaNode], [], [], [])
    expect(mihomo).toContain('type: hysteria')
    expect(mihomo).toContain('auth-str: "auth-secret"')
    expect(mihomo).toContain('up: "80 Mbps"')
    expect(mihomo).toContain('down: "120 Mbps"')

    const singbox = JSON.parse(generateSingboxJson([hysteriaNode], [], [], [])) as {
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.outbounds.find((item) => item.tag === hysteriaNode.name)).toMatchObject({
      type: 'hysteria',
      tag: 'SG Hysteria',
      server: 'sg.example.com',
      server_port: 443,
      auth_str: 'auth-secret',
      up_mbps: 80,
      down_mbps: 120,
      tls: {
        enabled: true,
        server_name: 'sg.example.com',
        insecure: true,
      },
    })
  })

  it('exports WireGuard nodes as sing-box 1.13 endpoints', () => {
    const singbox = JSON.parse(generateSingboxJson([wireguardNode], [], [], [])) as {
      endpoints?: Array<Record<string, unknown>>
      outbounds: Array<Record<string, unknown>>
    }
    expect(singbox.endpoints).toEqual([
      expect.objectContaining({
        type: 'wireguard',
        tag: wireguardNode.name,
        address: ['172.16.0.2/32'],
        private_key: 'private-key',
        peers: [
          expect.objectContaining({
            address: 'wg.example.com',
            port: 51820,
            public_key: 'peer-key',
            pre_shared_key: 'psk',
            allowed_ips: ['0.0.0.0/0', '::/0'],
          }),
        ],
      }),
    ])
    expect(singbox.outbounds.some((item) => item.type === 'wireguard')).toBe(false)
  })

  it('preserves current native WireGuard endpoint peers while applying editable primary fields', () => {
    const singbox = JSON.parse(generateSingboxJson([nativeWireGuardEndpointNode], [], [], [])) as {
      endpoints: Array<Record<string, unknown>>
    }

    expect(singbox.endpoints).toEqual([
      {
        type: 'wireguard',
        tag: 'Renamed WireGuard',
        address: ['172.16.0.3/32'],
        private_key: 'current-private-key',
        mtu: 1380,
        peers: [
          {
            address: 'primary-current.example.com',
            port: 51822,
            public_key: 'current-primary-key',
            allowed_ips: ['0.0.0.0/0', '::/0'],
            persistent_keepalive_interval: 30,
          },
          {
            address: 'backup.example.com',
            port: 51821,
            public_key: 'backup-key',
            allowed_ips: ['10.0.0.0/8'],
          },
        ],
      },
    ])
  })

  it('prefers native Mihomo node config while applying current identity fields', () => {
    const content = generateMihomoYaml([nativeMihomoNode], [], [], [])
    const parsed = yaml.load(content) as { proxies: Array<Record<string, unknown>> }

    expect(parsed.proxies[0]).toMatchObject({
      name: 'Renamed Mihomo SS',
      type: 'ss',
      server: 'new-mihomo.example.com',
      port: 8389,
      cipher: '2022-blake3-aes-128-gcm',
      udp: true,
      'plugin-opts': { mode: 'websocket', host: 'plugin.example.com' },
    })
  })

  it('prefers native sing-box outbounds while applying current identity fields', () => {
    const content = generateSingboxJson([nativeSingboxNode], [], [], [])
    const parsed = JSON.parse(content) as { outbounds: Array<Record<string, unknown>> }
    const outbound = parsed.outbounds.find((item) => item.type === 'shadowsocks')

    expect(outbound).toMatchObject({
      type: 'shadowsocks',
      tag: 'Renamed sing-box SS',
      server: 'new-singbox.example.com',
      server_port: 8390,
      method: '2022-blake3-aes-128-gcm',
      multiplex: { enabled: true },
    })
  })

  it('does not reference nodes missing from Mihomo proxies', () => {
    const content = generateMihomoYaml([ssNode, mihomoUnsupportedNode], [autoGroup], [], [], {
      'collection-auto': [ssNode.name, mihomoUnsupportedNode.name],
    })

    expect(content).toContain('name: "Supported SS"')
    expect(content).toContain('- "Supported SS"')
    expect(content).not.toContain('Unsupported WireGuard')
  })

  it('does not reference nodes missing from sing-box outbounds', () => {
    const content = generateSingboxJson([ssNode, singboxUnsupportedNode], [autoGroup], [], [], {
      'collection-auto': [ssNode.name, singboxUnsupportedNode.name],
    })
    const config = JSON.parse(content) as {
      outbounds: Array<{ tag: string; outbounds?: string[] }>
    }
    const tags = new Set(config.outbounds.map((outbound) => outbound.tag))
    const auto = config.outbounds.find((outbound) => outbound.tag === autoGroup.name)

    expect(tags.has(ssNode.name)).toBe(true)
    expect(tags.has(singboxUnsupportedNode.name)).toBe(false)
    expect(auto?.outbounds).toEqual([ssNode.name])
  })

  it('expands collection-backed groups to concrete node members for every full-config exporter', () => {
    const collectionNodeNames = { 'collection-auto': [ssNode.name] }
    const rows = [toRow(autoGroup)]
    const nodeRows = [toNodeRow(ssNode)]

    const mihomo = yaml.load(generateMihomoYaml([ssNode], [autoGroup], [], [], collectionNodeNames)) as {
      proxies: Array<{ name: string }>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
    }
    expect(mihomo.proxies.map((node) => node.name)).toContain(ssNode.name)
    expect(mihomo['proxy-groups'].find((group) => group.name === autoGroup.name)?.proxies).toContain(ssNode.name)

    const stash = yaml.load(generateStashYaml([ssNode], [autoGroup], [], [], collectionNodeNames)) as {
      proxies: Array<{ name: string }>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
    }
    expect(stash.proxies.map((node) => node.name)).toContain(ssNode.name)
    expect(stash['proxy-groups'].find((group) => group.name === autoGroup.name)?.proxies).toContain(ssNode.name)

    const singbox = JSON.parse(generateSingboxJson([ssNode], [autoGroup], [], [], collectionNodeNames)) as {
      outbounds: Array<{ tag: string; outbounds?: string[] }>
    }
    expect(singbox.outbounds.map((outbound) => outbound.tag)).toContain(ssNode.name)
    expect(singbox.outbounds.find((outbound) => outbound.tag === autoGroup.name)?.outbounds).toContain(ssNode.name)

    const loon = generateLoon(nodeRows, rows, [], [], collectionNodeNames)
    expect(loon).toContain(`${ssNode.name} = Shadowsocks`)
    expect(loon).toContain(`${autoGroup.name} = url-latency-benchmark, ${ssNode.name}`)

    const surge = generateSurge(nodeRows, rows, [], [], collectionNodeNames)
    expect(surge).toContain(`${ssNode.name} = ss`)
    expect(surge).toContain(`${autoGroup.name} = url-test, ${ssNode.name}`)

    const shadowrocket = generateShadowrocket(nodeRows, rows, [], [], collectionNodeNames)
    expect(shadowrocket).toContain(`${ssNode.name} = ss`)
    expect(shadowrocket).toContain(`${autoGroup.name} = url-test, ${ssNode.name}`)

    const quantumultx = generateQuantumultX(nodeRows, rows, [], [], collectionNodeNames)
    expect(quantumultx).toContain(`url-latency-benchmark=${autoGroup.name}, ${ssNode.name}`)

    const egern = yaml.load(generateEgern(nodeRows, rows, [], [], collectionNodeNames)) as {
      proxies: Array<Record<string, { name: string }>>
      policy_groups: Array<Record<string, { name: string; policies: string[] }>>
    }
    expect(egern.proxies.map(egernEntryBody).map((node) => node?.name)).toContain(ssNode.name)
    expect(egern.policy_groups.map(egernEntryBody).find((group) => group?.name === autoGroup.name)?.policies).toContain(
      ssNode.name,
    )
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
      [],
    )

    expect(content).toContain('proxy-groups: []')
    expect(content).not.toContain('type: direct')
    expect(content).not.toContain('type: reject')
    expect(content).toContain('  - DOMAIN,example.com,DIRECT')
    expect(content).toContain('  - DOMAIN-SUFFIX,ads.example,REJECT')
  })

  it('maps Mihomo nested native outlet groups to built-in policy names', () => {
    const customNamedDirectGroup: ProxyGroup = {
      ...directGroup,
      name: 'DIRECT-GROUP',
    }
    const selector: ProxyGroup = {
      ...autoGroup,
      id: 'group-selector',
      name: 'Selector',
      type: 'select',
      collectionIds: [],
      groupIds: [customNamedDirectGroup.id],
    }

    const content = generateMihomoYaml([], [selector, customNamedDirectGroup], [], [])

    expect(content).toContain('  - name: "Selector"')
    expect(content).toContain('      - "DIRECT"')
    expect(content).not.toContain('DIRECT-GROUP')
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
      [],
    )
    const config = JSON.parse(content) as {
      outbounds: Array<{ tag: string; type: string }>
      route: { rules: Array<Record<string, unknown>> }
    }

    expect(config.outbounds).toContainEqual(expect.objectContaining({ tag: 'direct', type: 'direct' }))
    expect(config.outbounds.some((outbound) => outbound.type === 'block')).toBe(false)
    expect(config.outbounds.some((outbound) => outbound.tag === 'DIRECT')).toBe(false)
    expect(config.outbounds.some((outbound) => outbound.tag === 'REJECT')).toBe(false)
    expect(config.route.rules).toContainEqual({ domain: ['example.com'], outbound: 'direct' })
    expect(config.route.rules).toContainEqual({ domain_suffix: ['ads.example'], action: 'reject' })
  })

  it('keeps every advertised sing-box manual-rule capability aligned with serialization', () => {
    const payloads: Record<ProxyRule['type'], string> = {
      DOMAIN: 'example.com',
      'DOMAIN-SUFFIX': 'example.com',
      'DOMAIN-KEYWORD': 'example',
      'DOMAIN-REGEX': '^api\\.',
      'IP-CIDR': '192.0.2.0/24',
      'IP-CIDR6': '2001:db8::/32',
      'IP-ASN': '13335',
      GEOIP: 'CN',
      GEOSITE: 'CN',
      'PROCESS-NAME': 'curl',
      'PROCESS-PATH': '/usr/bin/curl',
      PORT: '443',
      'SRC-PORT': '12345',
      'SRC-IP-CIDR': '10.0.0.0/8',
      PROTOCOL: 'HTTP',
      NETWORK: 'TCP',
      'IN-TYPE': 'TUN',
      'RULE-SET': 'custom-rules',
      SCRIPT: 'script-name',
      MATCH: '',
    }

    for (const type of Object.keys(RULE_COMPATIBILITY) as ProxyRule['type'][]) {
      const rule: ProxyRule = {
        id: `rule-${type}`,
        type,
        payload: payloads[type],
        targetGroupId: directGroup.id,
        enabled: true,
        order: 1,
        compatibility: [],
        createdAt,
        updatedAt: createdAt,
      }
      const config = JSON.parse(generateSingboxJson([], [directGroup], [rule], [])) as {
        route: { rules: Array<Record<string, unknown>>; final?: string }
      }
      const serialized = type === 'MATCH' ? config.route.final === 'direct' : config.route.rules.length > 2
      const advertised = getRuleCompatibilityLevel(type, 'singbox') !== 'unsupported'

      expect(serialized, `${type} serialization must match its sing-box capability level`).toBe(advertised)
    }
  })

  it('exports sing-box GEOIP rules through binary rule sets', () => {
    const rule: ProxyRule = {
      id: 'rule-geoip',
      type: 'GEOIP',
      payload: 'CN',
      targetGroupId: directGroup.id,
      enabled: true,
      order: 1,
      compatibility: [],
      createdAt,
      updatedAt: createdAt,
    }
    const config = JSON.parse(generateSingboxJson([], [directGroup], [rule], [])) as {
      route: {
        rules: Array<Record<string, unknown>>
        rule_set: Array<Record<string, unknown>>
      }
    }

    expect(config.route.rules).toContainEqual({
      rule_set: ['geoip-cn'],
      outbound: 'direct',
    })
    expect(config.route.rule_set).toContainEqual(
      expect.objectContaining({
        tag: 'geoip-cn',
        format: 'binary',
        url: 'https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs',
      }),
    )
  })

  it('serializes canonical manual port ranges with sing-box range fields', () => {
    const rules: ProxyRule[] = [
      {
        id: 'rule-port-range',
        type: 'PORT',
        payload: '8000-9000',
        targetGroupId: directGroup.id,
        enabled: true,
        order: 1,
        compatibility: [],
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'rule-source-port-range',
        type: 'SRC-PORT',
        payload: '1000:2000',
        targetGroupId: directGroup.id,
        enabled: true,
        order: 2,
        compatibility: [],
        createdAt,
        updatedAt: createdAt,
      },
    ]
    const config = JSON.parse(generateSingboxJson([], [directGroup], rules, [])) as {
      route: { rules: Array<Record<string, unknown>> }
    }

    expect(config.route.rules).toContainEqual({
      port_range: ['8000:9000'],
      outbound: 'direct',
    })
    expect(config.route.rules).toContainEqual({
      source_port_range: ['1000:2000'],
      outbound: 'direct',
    })
  })

  it('converts value-dependent network, protocol, and port rules per client', () => {
    const definitions: Array<[ProxyRule['type'], string, boolean?]> = [
      ['PROTOCOL', 'tcp'],
      ['PROTOCOL', 'http'],
      ['PROTOCOL', 'https'],
      ['NETWORK', 'icmp'],
      ['PORT', '443', true],
      ['SRC-PORT', '12345'],
      ['SRC-IP-CIDR', '10.0.0.0/8'],
      ['IP-ASN', '13335'],
    ]
    const rules = definitions.map(([type, payload, noResolve], index): ProxyRule => ({
      id: `value-rule-${index}`,
      type,
      payload,
      targetGroupId: directGroup.id,
      noResolve,
      enabled: true,
      order: index,
      compatibility: [],
      createdAt,
      updatedAt: createdAt,
    }))
    const ruleRows = rules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      payload: rule.payload,
      target_group_id: rule.targetGroupId,
      no_resolve: rule.noResolve ? 1 : 0,
      enabled: 1,
      sort_order: rule.order,
      compatibility: '[]',
      created_at: createdAt,
      updated_at: createdAt,
    }))

    const mihomo = generateMihomoYaml([], [directGroup], rules, [])
    expect(mihomo).toContain('  - NETWORK,tcp,DIRECT')
    expect(mihomo).toContain('  - DST-PORT,443,DIRECT')
    expect(mihomo).not.toContain('PROTOCOL,http')
    expect(mihomo).not.toContain('PROTOCOL,https')
    expect(mihomo).not.toContain('NETWORK,icmp')
    expect(mihomo).not.toContain('DST-PORT,443,DIRECT,no-resolve')

    const singbox = JSON.parse(generateSingboxJson([], [directGroup], rules, [])) as {
      route: { rules: Array<Record<string, unknown>> }
    }
    expect(singbox.route.rules).toContainEqual({ network: ['tcp'], outbound: 'direct' })
    expect(singbox.route.rules).toContainEqual({ protocol: ['http'], outbound: 'direct' })
    expect(singbox.route.rules).toContainEqual({ network: ['icmp'], outbound: 'direct' })
    expect(singbox.route.rules).not.toContainEqual(expect.objectContaining({ protocol: ['https'] }))

    const surge = generateSurge([], [toRow(directGroup)], ruleRows, [])
    expect(surge).toContain('PROTOCOL,TCP,DIRECT')
    expect(surge).toContain('PROTOCOL,HTTP,DIRECT')
    expect(surge).toContain('PROTOCOL,HTTPS,DIRECT')
    expect(surge).toContain('DEST-PORT,443,DIRECT')
    expect(surge).toContain('SRC-IP,10.0.0.0/8,DIRECT')
    expect(surge).not.toContain('NETWORK,icmp')
    expect(surge).not.toContain('DEST-PORT,443,DIRECT,no-resolve')

    const loon = generateLoon([], [toRow(directGroup)], ruleRows, [])
    expect(loon).toContain('PROTOCOL, TCP, DIRECT')
    expect(loon).toContain('DEST-PORT, 443, DIRECT')
    expect(loon).toContain('SRC-PORT, 12345, DIRECT')
    expect(loon).toContain('IPASN, 13335, DIRECT')
    expect(loon).not.toContain('PROTOCOL, HTTP, DIRECT')
    expect(loon).not.toContain('NETWORK, icmp, DIRECT')

    const shadowrocket = generateShadowrocket([], [toRow(directGroup)], ruleRows, [])
    expect(shadowrocket).toContain('DST-PORT,443,DIRECT')
    expect(shadowrocket).not.toContain('\nPORT,443,DIRECT')

    const quantumultx = generateQuantumultX([], [toRow(directGroup)], ruleRows, [])
    expect(quantumultx).not.toContain('PORT,443,DIRECT')
    expect(quantumultx).not.toContain('SRC-PORT,12345,DIRECT')

    const egern = yaml.load(generateEgern([], [toRow(directGroup)], ruleRows, [])) as {
      rules: Array<Record<string, { match?: string }>>
    }
    expect(egern.rules).toContainEqual({ protocol: { match: 'tcp', policy: 'DIRECT' } })
    expect(egern.rules).toContainEqual({ protocol: { match: 'http', policy: 'DIRECT' } })
    expect(egern.rules).toContainEqual({ protocol: { match: 'https', policy: 'DIRECT' } })
    expect(egern.rules).not.toContainEqual({ protocol: expect.objectContaining({ match: 'icmp' }) })
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
      policy_groups: Array<Record<string, { name: string }>>
      rules: Array<Record<string, unknown>>
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
    expect(egern.policy_groups.map(egernEntryBody).some((group) => group?.name === 'DIRECT')).toBe(false)
    expect(egern.policy_groups.map(egernEntryBody).some((group) => group?.name === 'REJECT')).toBe(false)
    expect(egern.rules).toContainEqual({ domain: { match: 'example.com', policy: 'DIRECT' } })
    expect(egern.rules).toContainEqual({
      domain_suffix: { match: 'ads.example', policy: 'REJECT' },
    })
  })
})

function egernEntryBody<T>(entry: Record<string, T>): T | undefined {
  return Object.values(entry)[0]
}

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

function toNodeRow(node: ProxyNode): Record<string, unknown> {
  return {
    id: node.id,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    raw_config: JSON.stringify(node.rawConfig),
    parsed_config: JSON.stringify(node.parsedConfig),
  }
}
