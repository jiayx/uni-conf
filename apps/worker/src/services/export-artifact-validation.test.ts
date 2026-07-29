import { describe, expect, it } from 'vitest'
import { dump as toYaml } from 'js-yaml'
import type { ExportFormat } from '@uni-conf/types'
import { exportArtifactWarnings, validateRenderedExport } from './export-artifact-validation'

describe('export artifact validation', () => {
  it.each([
    ['mihomo', validMihomoYaml()],
    ['clash', validMihomoYaml()],
    ['stash', validMihomoYaml()],
    ['singbox', JSON.stringify({ outbounds: [{ type: 'direct', tag: 'direct' }], route: { rules: [{ outbound: 'direct' }], final: 'direct' } })],
    ['egern', validEgernYaml()],
    ['loon', validLoonIni()],
    ['surge', validTextClientIni()],
    ['shadowrocket', validTextClientIni()],
    ['quantumultx', validQuantumultXIni()],
    ['nodes_raw', 'ss://encoded-node'],
    ['nodes_base64', btoa('ss://encoded-node')],
  ] as Array<[ExportFormat, string]>)('accepts a structurally valid %s artifact', (format, content) => {
    expect(validateRenderedExport(format, content)).toEqual({
      format,
      kind: format === 'singbox' ? 'json'
        : ['mihomo', 'clash', 'stash', 'egern'].includes(format) ? 'yaml'
          : format.startsWith('nodes_') ? 'subscription' : 'ini',
      valid: true,
      issues: [],
    })
  })

  it('rejects malformed structured documents and missing required sections', () => {
    expect(validateRenderedExport('mihomo', 'proxies: [').issues[0]).toMatchObject({ code: 'parse_error' })
    expect(validateRenderedExport('singbox', '{').issues[0]).toMatchObject({ code: 'parse_error' })
    expect(validateRenderedExport('egern', 'proxies: []').issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty_section', path: 'proxies' }),
      expect.objectContaining({ code: 'missing_section', path: 'policy_groups' }),
    ]))
    expect(validateRenderedExport('surge', '[General]\nloglevel=notify').issues).toHaveLength(3)
  })

  it('detects dangling Mihomo policy references', () => {
    const validation = validateRenderedExport('mihomo', toYaml({
      proxies: [{ name: 'Node' }],
      'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Missing Node'] }],
      rules: ['MATCH,Missing Policy'],
    }))

    expect(validation.valid).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_reference', path: 'proxy-groups[0].proxies' }),
      expect.objectContaining({ code: 'missing_reference', path: 'rules[0]' }),
    ]))
  })

  it('validates Mihomo rule-provider references and remote URLs', () => {
    const validation = validateRenderedExport('mihomo', toYaml({
      proxies: [{ name: 'Node' }],
      'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Node'] }],
      'rule-providers': {
        Broken: { type: 'http', url: 'file:///rules.yaml' },
      },
      rules: ['RULE-SET,Missing,PROXY', 'MATCH,PROXY'],
    }))
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_reference', path: 'rules[0]' }),
      expect.objectContaining({ code: 'invalid_url', path: 'rule-providers.Broken.url' }),
    ]))
  })

  it('detects duplicate and dangling sing-box outbound tags', () => {
    const validation = validateRenderedExport('singbox', JSON.stringify({
      outbounds: [{ type: 'direct', tag: 'same' }, { type: 'block', tag: 'same' }],
      route: { rules: [{ outbound: 'missing' }], final: 'missing' },
    }))

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_tag' }),
      expect.objectContaining({ code: 'missing_reference', path: 'route.final' }),
      expect.objectContaining({ code: 'missing_reference', path: 'route.rules[0].outbound' }),
    ]))
  })

  it('validates sing-box rule-set tags, references, and remote URLs', () => {
    const validation = validateRenderedExport('singbox', JSON.stringify({
      outbounds: [{ type: 'direct', tag: 'direct' }],
      route: {
        rule_set: [
          { tag: 'duplicate', type: 'remote', format: 'source', url: 'file:///rules.json' },
          { tag: 'duplicate', type: 'remote', format: 'source', url: 'https://rules.example.com/source.json' },
        ],
        rules: [{ rule_set: ['missing'], outbound: 'direct' }],
        final: 'direct',
      },
    }))
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_url', path: 'route.rule_set[0].url' }),
      expect.objectContaining({ code: 'duplicate_tag', path: 'route.rule_set[1].tag' }),
      expect.objectContaining({ code: 'missing_reference', path: 'route.rules[0].rule_set' }),
    ]))
  })

  it('accepts WireGuard endpoints as route and selector targets', () => {
    const validation = validateRenderedExport('singbox', JSON.stringify({
      endpoints: [{
        type: 'wireguard',
        tag: 'WG',
        address: ['10.0.0.2/32'],
        private_key: 'private-key',
        peers: [{
          address: 'wg.example.com',
          port: 51820,
          public_key: 'public-key',
          allowed_ips: ['0.0.0.0/0', '::/0'],
        }],
      }],
      outbounds: [
        { type: 'selector', tag: 'PROXY', outbounds: ['WG'] },
        { type: 'direct', tag: 'direct' },
      ],
      route: {
        rules: [{ action: 'sniff' }, { outbound: 'WG' }],
        final: 'PROXY',
      },
    }))

    expect(validation).toMatchObject({ valid: true, issues: [] })
  })

  it('validates current Egern remote rule references and policy graph', () => {
    const valid = validateRenderedExport('egern', toYaml({
      proxies: [{ shadowsocks: { name: 'Node', server: 'node.example.com', port: 443, method: 'aes-256-gcm', password: 'secret' } }],
      policy_groups: [{ select: { name: 'PROXY', policies: ['Node', 'DIRECT'] } }],
      rules: [{
        rule_set: {
          match: 'https://rules.example.com/egern.yaml',
          policy: 'PROXY',
          update_interval: 86400,
        },
      }, { default: { policy: 'DIRECT' } }],
    }))
    expect(valid).toMatchObject({ valid: true, issues: [] })

    const invalid = validateRenderedExport('egern', toYaml({
      proxies: [
        { shadowsocks: { name: 'Node', server: 'one.example.com', port: 443, method: 'aes-256-gcm', password: 'secret' } },
        { shadowsocks: { name: 'Node', server: 'two.example.com', port: 443, method: 'aes-256-gcm', password: 'secret' } },
      ],
      policy_groups: [{ select: { name: 'PROXY', policies: ['Missing'] } }],
      rules: [{ rule_set: { match: 'file:///rules.yaml', policy: 'Missing', update_interval: 0 } }],
    }))
    expect(invalid.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_name', path: 'proxies[1].shadowsocks.name' }),
      expect.objectContaining({ code: 'missing_reference', path: 'policy_groups[0].select.policies[0]' }),
      expect.objectContaining({ code: 'invalid_url', path: 'rules[0].rule_set.match' }),
      expect.objectContaining({ code: 'missing_reference', path: 'rules[0].rule_set.policy' }),
      expect.objectContaining({ code: 'invalid_value', path: 'rules[0].rule_set.update_interval' }),
    ]))
  })

  it.each(['loon', 'surge', 'shadowrocket'] as const)('detects dangling %s text-client references', format => {
    const validation = validateRenderedExport(format, [
      '[General]', 'loglevel=notify',
      '[Proxy]', 'Node = ss, example.com, 443',
      '[Proxy Group]', 'PROXY = select, Missing Node',
      '[Rule]', 'FINAL,Missing Policy',
    ].join('\n'))
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_reference', path: 'proxy group[0]' }),
      expect.objectContaining({ code: 'missing_reference', path: 'rule[0]' }),
    ]))
  })

  it('recognizes Shadowrocket rule options after the policy target', () => {
    const validation = validateRenderedExport('shadowrocket', [
      '[General]', 'bypass-system = true',
      '[Proxy]', 'Node = ss, example.com, 443',
      '[Proxy Group]', 'PROXY = select, Node',
      '[Rule]',
      'DOMAIN-SUFFIX,example.com,PROXY,force-remote-dns',
      'IP-CIDR,192.0.2.0/24,PROXY,no-resolve',
      'DOMAIN,api.example.com,PROXY,no-resolve,force-remote-dns',
    ].join('\n'))

    expect(validation.issues).toEqual([])
  })

  it('validates native Surge proxy protocol fields', () => {
    const validation = validateRenderedExport('surge', [
      '[General]', 'loglevel=notify',
      '[Proxy]',
      'Legacy HTTPS = http, secure.example.com, 443, tls=true',
      'Broken VMess = vmess, vmess.example.com, 443',
      'Broken Hysteria = hysteria2, hy2.example.com, 443',
      '[Proxy Group]', 'PROXY = select, Legacy HTTPS, Broken VMess, Broken Hysteria',
      '[Rule]', 'FINAL,PROXY',
    ].join('\n'))

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_entry', path: 'proxy[0]' }),
      expect.objectContaining({ code: 'missing_field', path: 'proxy[1]' }),
      expect.objectContaining({ code: 'missing_field', path: 'proxy[2]' }),
    ]))
  })

  it('accepts native AnyTLS and rejects generic named fields in Loon proxy entries', () => {
    const validation = validateRenderedExport('loon', [
      '[General]', 'dns-server=system',
      '[Proxy]',
      'Legacy SS = Shadowsocks, example.com, 443, encrypt-method=aes-256-gcm, password=secret',
      'Legacy VMess = vmess, vmess.example.com, 443, username=uuid',
      'Native AnyTLS = AnyTLS, anytls.example.com, 443, "secret", sni=anytls.example.com, udp=true',
      'Legacy AnyTLS = AnyTLS, legacy-anytls.example.com, 443, password=secret',
      'gRPC VLESS = VLESS, grpc.example.com, 443, "uuid", transport=grpc, over-tls=true',
      '[Proxy Group]', 'PROXY = select, Legacy SS, Legacy VMess, Native AnyTLS, Legacy AnyTLS, gRPC VLESS',
      '[Rule]', 'FINAL,PROXY',
    ].join('\n'))

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_entry', path: 'proxy[0]' }),
      expect.objectContaining({ code: 'missing_field', path: 'proxy[1]' }),
      expect.objectContaining({ code: 'invalid_entry', path: 'proxy[3]' }),
      expect.objectContaining({ code: 'invalid_value', path: 'proxy[4]' }),
    ]))
    expect(validation.issues).not.toContainEqual(expect.objectContaining({ path: 'proxy[2]' }))
  })

  it('rejects legacy Loon policy and TLS parameter names', () => {
    const validation = validateRenderedExport('loon', [
      '[General]', 'dns-server=system',
      '[Proxy]',
      'Legacy TLS = Trojan,legacy.example.com,443,"secret",tls-name=legacy.example.com',
      '[Proxy Group]', 'AUTO = url-latency-benchmark, Legacy TLS, url=https://example.com/generate_204, interval=300',
      '[Rule]', 'FINAL,AUTO',
    ].join('\n'))

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_entry', path: 'proxy[0]' }),
      expect.objectContaining({ code: 'invalid_entry', path: 'proxy group[0]' }),
    ]))
  })

  it('accepts current Surge and Loon protocol declarations', () => {
    const surge = validateRenderedExport('surge', [
      '[General]', 'dns-server=system',
      '[Proxy]',
      'SSH = ssh, ssh.example.com, 22, username=root, password=secret',
      'WG = wireguard, section-name=wg_node',
      'Snell = snell, snell.example.com, 44046, psk=secret, version=4',
      'Trust = trust-tunnel, trust.example.com, 443, username=user, password=secret',
      '[WireGuard wg_node]',
      'private-key = private',
      'self-ip = 10.0.0.2',
      'peer = (public-key = public, allowed-ips = 0.0.0.0/0, endpoint = wg.example.com:51820)',
      '[Proxy Group]', 'PROXY = select, SSH, WG, Snell, Trust',
      '[Rule]', 'FINAL,PROXY',
    ].join('\n'))
    const loon = validateRenderedExport('loon', [
      '[General]', 'dns-server=system',
      '[Proxy]',
      'SOCKS = socks5,socks.example.com,1080,"user","password",udp=true',
      'TLS = Trojan,tls.example.com,443,"secret",sni=tls.example.com',
      'WG = wireguard,interface-ip=10.0.0.2,private-key="private",peers=[{public-key="public",allowed-ips="0.0.0.0/0",endpoint=wg.example.com:51820}],udp=true',
      '[Proxy Group]', 'AUTO = url-test, SOCKS, TLS, WG, url=https://example.com/generate_204, interval=300',
      '[Rule]', 'FINAL,AUTO',
    ].join('\n'))

    expect(surge.issues).toEqual([])
    expect(loon.issues).toEqual([])
  })

  it('detects dangling Quantumult X policy and rule references', () => {
    const validation = validateRenderedExport('quantumultx', [
      '[general]', 'server_check_url=https://example.com/generate_204',
      '[server_local]', 'ss://encoded#Node',
      '[policy]', 'static=PROXY, Missing Node',
      '[filter_local]', 'FINAL,Missing Policy',
    ].join('\n'))
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_entry', path: 'server_local[0]' }),
      expect.objectContaining({ code: 'missing_reference', path: 'policy[0]' }),
      expect.objectContaining({ code: 'missing_reference', path: 'filter_local[0]' }),
    ]))
  })

  it('rejects policy syntax borrowed from other clients in Quantumult X', () => {
    const validation = validateRenderedExport('quantumultx', [
      '[general]', 'server_check_url=https://example.com/generate_204',
      '[server_local]', 'shadowsocks=example.com:443, method=aes-256-gcm, password=secret, tag=Node',
      '[policy]',
      'url-latency-benchmark=AUTO, Node, url=https://example.com/generate_204, interval=300',
      'fallback=BACKUP, Node',
      '[filter_local]', 'FINAL,AUTO',
    ].join('\n'))

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_entry', path: 'policy[0]' }),
      expect.objectContaining({ code: 'invalid_entry', path: 'policy[1]' }),
    ]))
  })

  it('rejects malformed node subscriptions', () => {
    expect(validateRenderedExport('nodes_raw', 'not a uri')).toMatchObject({ valid: false })
    expect(validateRenderedExport('nodes_base64', '%%%').issues[0]).toMatchObject({ code: 'invalid_base64' })
  })

  it('converts artifact issues into blocking compatibility warnings', () => {
    const validation = validateRenderedExport('mihomo', 'invalid: true')
    expect(exportArtifactWarnings(validation)).toEqual([
      expect.objectContaining({ client: 'mihomo', level: 'unsupported' }),
      expect.objectContaining({ client: 'mihomo', level: 'unsupported' }),
      expect.objectContaining({ client: 'mihomo', level: 'unsupported' }),
    ])
  })
})

function validMihomoYaml(): string {
  return toYaml({
    proxies: [{ name: 'Node', type: 'ss' }],
    'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Node'] }],
    rules: ['MATCH,PROXY'],
  })
}

function validEgernYaml(): string {
  return toYaml({
    proxies: [{
      shadowsocks: {
        name: 'Node',
        server: 'node.example.com',
        port: 443,
        method: 'aes-256-gcm',
        password: 'secret',
      },
    }],
    policy_groups: [{ select: { name: 'PROXY', policies: ['Node'] } }],
    rules: [{ default: { policy: 'PROXY' } }],
  })
}

function validTextClientIni(): string {
  return [
    '[General]', 'loglevel=notify',
    '[Proxy]', 'Node = ss, example.com, 443, encrypt-method=aes-256-gcm, password=secret',
    '[Proxy Group]', 'PROXY = select, Node',
    '[Rule]', 'FINAL,PROXY',
  ].join('\n')
}

function validLoonIni(): string {
  return [
    '[General]', 'dns-server=system',
    '[Proxy]', 'Node = Shadowsocks,example.com,443,aes-256-gcm,"secret"',
    '[Proxy Group]', 'PROXY = select, Node',
    '[Rule]', 'FINAL,PROXY',
  ].join('\n')
}

function validQuantumultXIni(): string {
  return [
    '[general]', 'server_check_url=https://example.com/generate_204',
    '[server_local]', 'shadowsocks=example.com:443, method=aes-256-gcm, password=secret, tag=Node',
    '[policy]', 'static=PROXY, Node',
    '[filter_local]', 'FINAL,PROXY',
  ].join('\n')
}
