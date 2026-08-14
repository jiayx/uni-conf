import * as yaml from 'js-yaml'
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_RULE_TARGET_GROUP_ID,
  isWorkspaceEntityId,
  getRuleCompatibilityLevel,
  isEgernTransportSupported,
  isRuleSetFormatCompatible,
  resolveRuleForExport,
  getRuleNoResolveHandling,
} from '@uni-conf/shared'
import { generateMihomoYaml } from './mihomo'
import { collectGroupMembers } from './group-members'
import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'
import type { ExportDnsPolicy, ProxyGroup, ProxyNode, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import { DEFAULT_FAKE_IP_POLICY, inlineRealIpDomains } from './dns-policy'
import {
  ASN_MMDB_URL,
  GEOIP_MMDB_URL,
  LOCAL_PROXY_BYPASS_ENTRIES,
  TUN_EXCLUDED_ROUTE_ENTRIES,
} from './network-defaults'
import {
  MAINLAND_DNS_BOOTSTRAP,
  MAINLAND_DOH_SERVERS,
  OVERSEAS_DOH_SERVERS,
} from './dns-defaults'

type Row = Record<string, unknown>
type RuleCompatibilityType = Parameters<typeof getRuleCompatibilityLevel>[0]
type ClientGeneratorOptions = {
  dnsPolicy?: ExportDnsPolicy
  managedRealIpDomains?: string[]
  ruleSetConversionBaseUrl?: string
}

const LOCAL_PROXY_BYPASS = LOCAL_PROXY_BYPASS_ENTRIES.join(', ')
const TUN_EXCLUDED_ROUTES = TUN_EXCLUDED_ROUTE_ENTRIES.join(', ')
const EGERN_BYPASS_TUNNEL_PROXY = [...new Set([...LOCAL_PROXY_BYPASS_ENTRIES, ...TUN_EXCLUDED_ROUTE_ENTRIES])]

export function generateStashYaml(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  collectionNodeNames: Record<string, string[]> = {},
  options: ClientGeneratorOptions = {},
): string {
  return generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, {
    ...options,
    ruleSetExportFormat: 'stash',
  })
}

export function generateSurge(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: ClientGeneratorOptions = {},
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY
  const lines = buildIniConfig({
    client: 'surge',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
    ruleSetConversionBaseUrl: options.ruleSetConversionBaseUrl,
    general: surgeGeneralLines(dnsPolicy, options.managedRealIpDomains),
    proxySections: surgeAuxiliarySections(nodes),
    trailingSections: [
      '[URL Rewrite]',
      '[Header Rewrite]',
      '[Body Rewrite]',
      '[Map Local]',
      '[Script]',
      '[MITM]',
    ],
  })
  return lines.join('\n')
}

export function generateShadowrocket(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: ClientGeneratorOptions = {},
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY
  const lines = buildIniConfig({
    client: 'shadowrocket',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
    ruleSetConversionBaseUrl: options.ruleSetConversionBaseUrl,
    general: shadowrocketGeneralLines(dnsPolicy, options.managedRealIpDomains),
    forceRemoteDns: true,
    trailingSections: ['[URL Rewrite]', '[Script]', '[MITM]'],
  })
  return lines.join('\n')
}

export function generateQuantumultX(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: ClientGeneratorOptions = {},
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY
  const serializedNodes = nodes
    .map((node) => ({ node, line: nodeToQuantumultX(node) }))
    .filter((item): item is { node: Row; line: string } => item.line !== null)
  const nodeLines = serializedNodes.map((item) => item.line)
  const nodeNames = serializedNodes.map((item) => String(item.node['name'] ?? '')).filter(Boolean)
  const lines: string[] = [
    '[general]',
    `server_check_url=${DEFAULT_HEALTH_CHECK.testUrl}`,
    'server_check_timeout=5000',
    'network_check_url=http://connectivitycheck.gstatic.com/generate_204',
    'fallback_udp_policy=reject',
    'dns_reject_domain_behavior=no-error-no-answer',
    `excluded_routes=${TUN_EXCLUDED_ROUTES}`,
    'icmp_auto_reply=true',
    `dns_exclusion_list=${inlineRealIpDomains(dnsPolicy, 'quantumultx', options.managedRealIpDomains).join(', ')}`,
    '',
    '[dns]',
    'no-system',
    'no-ipv6',
    `doh-server = ${MAINLAND_DOH_SERVERS.join(', ')}`,
    '',
    '[policy]',
  ]
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)

  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToQuantumultX(group, groups, nodeNames, collectionNodeNames))
  }

  lines.push('', '[server_remote]', '', '[filter_remote]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'quantumultx', options.ruleSetConversionBaseUrl)
    if (!resolved || !isRuleSetFormatCompatible('quantumultx', resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`${resolved.url}, tag=${rs['name']}, force-policy=${target}, enabled=true`)
  }

  lines.push('', '[rewrite_remote]', '', '[server_local]', ...nodeLines, '', '[filter_local]')
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToQuantumultX(rule, groups)
    if (line) lines.push(line)
  }
  if (!hasEnabledMatchRule(rules)) {
    lines.push(`FINAL,${defaultPolicy(groups)}`)
  }
  lines.push('', '[rewrite_local]', '', '[task_local]', '', '[http_backend]', '', '[mitm]', '')

  return lines.join('\n')
}

export function generateEgern(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: ClientGeneratorOptions = {},
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY
  const proxies = nodes.map(nodeToEgernProxy).filter((proxy): proxy is Record<string, unknown> => proxy !== null)
  const nodeNames = proxies.map(egernEntryName).filter(Boolean)
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)
  const remoteRules = sortedRemoteSets
    .filter((rs) => rs['enabled'])
    .map((rs) => ({
      source: rs,
      resolved: resolveRemoteRuleSetRowForExport(rs, 'egern', options.ruleSetConversionBaseUrl),
    }))
    .filter(
      (item): item is { source: Row; resolved: { url: string; format: string } } =>
        Boolean(item.resolved) && isRuleSetFormatCompatible('egern', item.resolved!.format),
    )
    .map(({ source: rs, resolved }) => ({
      rule_set: {
        match: resolved.url,
        policy: resolveGroupName(String(rs['target_group_id'] ?? ''), groups),
        update_interval: Number(rs['update_interval'] ?? 24) * 3600,
      },
    }))
  const localRules = rules
    .filter((rule) => rule['enabled'])
    .map((rule) => ruleToEgern(rule, groups))
    .filter((rule): rule is Record<string, unknown> => Boolean(rule))
  const hasDefaultRule = rules.some((rule) => rule['enabled'] && String(rule['type']) === 'MATCH')
  const autoUpdateUrl = options.ruleSetConversionBaseUrl?.replace(/\/rules\/?$/, '/egern.yaml')

  const config = {
    ...(autoUpdateUrl ? { auto_update: { url: autoUpdateUrl, interval: 86400 } } : {}),
    ipv6: false,
    http_port: 3080,
    socks_port: 3090,
    allow_external_connections: false,
    vif_only: false,
    block_quic: false,
    close_connections_on_policy_change: false,
    bypass_tunnel_proxy: EGERN_BYPASS_TUNNEL_PROXY,
    real_ip_domains: inlineRealIpDomains(dnsPolicy, 'egern', options.managedRealIpDomains),
    hide_vpn_icon: false,
    hijack_dns: ['*'],
    geoip_db_url: GEOIP_MMDB_URL,
    asn_db_url: ASN_MMDB_URL,
    proxy_latency_test_url: DEFAULT_HEALTH_CHECK.testUrl,
    direct_latency_test_url: 'http://connectivitycheck.gstatic.com/generate_204',
    compat_route: false,
    include_all_networks: false,
    include_apns: false,
    include_cellular_services: false,
    include_local_networks: false,
    vif_excluded_routes: TUN_EXCLUDED_ROUTE_ENTRIES,
    dns: egernDns(dnsPolicy),
    proxies,
    policy_groups: exportPolicyGroups(groups).map((group) =>
      groupToEgern(group, groups, nodeNames, collectionNodeNames),
    ),
    rules: [...remoteRules, ...localRules, ...(hasDefaultRule ? [] : [{ default: { policy: defaultPolicy(groups) } }])],
  }

  return yaml.dump(config, { lineWidth: -1, noRefs: true })
}

function buildIniConfig({
  client,
  nodes,
  groups,
  rules,
  remoteSets,
  collectionNodeNames,
  ruleSetConversionBaseUrl,
  general,
  host,
  proxySections = [],
  trailingSections = [],
  forceRemoteDns = false,
}: {
  client: 'surge' | 'shadowrocket'
  nodes: Row[]
  groups: Row[]
  rules: Row[]
  remoteSets: Row[]
  collectionNodeNames: Record<string, string[]>
  ruleSetConversionBaseUrl?: string
  general: string[]
  host?: string[]
  proxySections?: string[]
  trailingSections?: string[]
  forceRemoteDns?: boolean
}): string[] {
  const validNodes: string[] = []
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)
  const lines: string[] = [...general, '[Proxy]']
  for (const node of nodes) {
    const line = nodeToIniProxy(node, client)
    if (line) {
      lines.push(line)
      validNodes.push(String(node['name'] ?? ''))
    }
  }

  if (proxySections.length > 0) lines.push('', ...proxySections)
  lines.push('', '[Proxy Group]')
  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToIni(group, groups, validNodes, collectionNodeNames))
  }

  lines.push('', '[Rule]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, client, ruleSetConversionBaseUrl)
    if (!resolved || !isRuleSetFormatCompatible(client, resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`RULE-SET,${resolved.url},${target}`)
  }
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToIni(rule, groups, client, forceRemoteDns)
    if (line) lines.push(line)
  }
  if (!hasEnabledMatchRule(rules)) {
    lines.push(`FINAL,${defaultPolicy(groups)}`)
  }
  lines.push('', '[Host]', ...(host ?? []))
  for (const section of trailingSections) lines.push('', section)
  lines.push('')

  return lines
}

function surgeGeneralLines(policy: ExportDnsPolicy, managedDomains?: string[]): string[] {
  return [
    '[General]',
    'loglevel = notify',
    'ipv6 = false',
    `geoip-maxmind-url = ${GEOIP_MMDB_URL}`,
    'disable-geoip-db-auto-update = false',
    `skip-proxy = ${LOCAL_PROXY_BYPASS}`,
    'exclude-simple-hostnames = true',
    `tun-excluded-routes = ${TUN_EXCLUDED_ROUTES}`,
    `dns-server = ${MAINLAND_DNS_BOOTSTRAP.join(', ')}`,
    `encrypted-dns-server = ${MAINLAND_DOH_SERVERS.join(', ')}`,
    `always-real-ip = ${inlineRealIpDomains(policy, 'surge', managedDomains).join(', ')}`,
    'hijack-dns = *:53',
    'udp-policy-not-supported-behaviour = REJECT',
    'allow-wifi-access = false',
    'wifi-access-http-port = 6152',
    'wifi-access-socks5-port = 6153',
    'internet-test-url = http://connectivitycheck.gstatic.com/generate_204',
    `proxy-test-url = ${DEFAULT_HEALTH_CHECK.testUrl}`,
    'test-timeout = 5',
    '',
  ]
}

function shadowrocketGeneralLines(policy: ExportDnsPolicy, managedDomains?: string[]): string[] {
  return [
    '[General]',
    'bypass-system = true',
    'ipv6 = false',
    'prefer-ipv6 = false',
    `skip-proxy = ${LOCAL_PROXY_BYPASS}`,
    `tun-excluded-routes = ${TUN_EXCLUDED_ROUTES}`,
    `dns-server = ${MAINLAND_DOH_SERVERS.join(', ')}`,
    `fallback-dns-server = ${OVERSEAS_DOH_SERVERS.map((server) => `${server}#proxy`).join(', ')}`,
    'dns-fallback-system = false',
    `always-real-ip = ${inlineRealIpDomains(policy, 'shadowrocket', managedDomains).join(', ')}`,
    'hijack-dns = *:53',
    'dns-direct-system = false',
    'icmp-auto-reply = true',
    'always-reject-url-rewrite = false',
    'private-ip-answer = true',
    'dns-direct-fallback-proxy = true',
    'udp-policy-not-supported-behaviour = REJECT',
    '',
  ]
}

function egernDns(_policy: ExportDnsPolicy): Record<string, unknown> {
  return {
    bootstrap: [...MAINLAND_DNS_BOOTSTRAP],
    upstreams: {
      mainland: [...MAINLAND_DOH_SERVERS],
    },
    forward: [
      {
        domain_wildcard: {
          match: '*',
          value: 'mainland',
        },
      },
    ],
  }
}

function nodeToIniProxy(node: Row, client: 'surge' | 'shadowrocket'): string | null {
  return client === 'surge' ? nodeToSurgeProxy(node) : nodeToShadowrocketProxy(node)
}

function nodeToSurgeProxy(node: Row): string | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = asRecord(parsed['extra'])
  if (!name || !server || !port) return null

  const prefix = `${name} = ${protocol}, ${server}, ${port}`
  const password = String(parsed['password'] ?? '')
  if (protocol === 'ss') {
    const method = String(extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm')
    const fields = [`encrypt-method=${method}`, `password=${password}`]
    if (extra['udp'] !== undefined) fields.push(`udp-relay=${Boolean(extra['udp'])}`)
    const obfs = String(extra['obfs'] ?? '')
    if (obfs === 'http' || obfs === 'tls') {
      fields.push(`obfs=${obfs}`)
      const host = String(extra['obfsHost'] ?? extra['obfsParam'] ?? '')
      if (host) fields.push(`obfs-host=${host}`)
    }
    return `${prefix}, ${fields.join(', ')}`
  }
  if (protocol === 'vmess') {
    const fields = [`username=${String(parsed['uuid'] ?? '')}`, ...surgeWebSocketFields(parsed)]
    if (parsed['tls']) fields.push('tls=true', ...surgeTlsFields(parsed, extra))
    const method = String(extra['cipher'] ?? '')
    if (['chacha20-ietf-poly1305', 'aes-128-gcm'].includes(method)) {
      fields.push(`encrypt-method=${method}`)
    }
    return `${prefix}, ${fields.join(', ')}`
  }
  if (protocol === 'trojan') {
    return `${prefix}, ${[
      `password=${password}`,
      ...surgeWebSocketFields(parsed),
      ...surgeTlsFields(parsed, extra),
      ...(extra['udp'] !== undefined ? [`udp-relay=${Boolean(extra['udp'])}`] : []),
    ].join(', ')}`
  }
  if (protocol === 'anytls') {
    return `${prefix}, ${[
      `password=${password}`,
      ...surgeTlsFields(parsed, extra),
      ...(extra['reuse'] !== undefined ? [`reuse=${Boolean(extra['reuse'])}`] : []),
    ].join(', ')}`
  }
  if (protocol === 'hysteria2') {
    const fields = [`password=${password || String(extra['auth'] ?? '')}`, ...surgeTlsFields(parsed, extra)]
    if (extra['downMbps']) fields.push(`download-bandwidth=${Number(extra['downMbps'])}`)
    if (extra['ports'] ?? extra['portHopping']) {
      fields.push(`port-hopping=${String(extra['ports'] ?? extra['portHopping'])}`)
    }
    if (extra['portHoppingInterval'] !== undefined) {
      fields.push(`port-hopping-interval=${Number(extra['portHoppingInterval'])}`)
    }
    if (extra['obfs'] === 'salamander' && extra['obfsPassword']) {
      fields.push(`salamander-password=${String(extra['obfsPassword'])}`)
    }
    return `${prefix}, ${fields.join(', ')}`
  }
  if (protocol === 'ssh') {
    const username = String(extra['username'] ?? extra['user'] ?? '')
    const privateKey = extra['privateKey'] ?? extra['private-key']
    if (!username || (!password && !privateKey)) return null
    const fields = [`username=${username}`]
    if (password) {
      fields.push(`password=${password}`)
    } else if (privateKey) {
      fields.push(`private-key=${surgeSshKeyName(node)}`)
    }
    const hostKeys = configStringArray(extra['hostKeys'] ?? extra['host-key'])
    if (hostKeys.length > 0) fields.push(`server-fingerprint=${quoteIniValue(hostKeys.join(','))}`)
    if (extra['idleTimeout'] !== undefined) fields.push(`idle-timeout=${Number(extra['idleTimeout'])}`)
    return `${prefix}, ${fields.join(', ')}`
  }
  if (protocol === 'wireguard') {
    if (surgeWireGuardSectionLines(node, extra).length === 0) return null
    return `${name} = wireguard, section-name=${surgeWireGuardSectionName(node)}`
  }
  if (protocol === 'snell') {
    const psk = String(extra['psk'] ?? password)
    if (!psk) return null
    const fields = [`psk=${psk}`, `version=${Number(extra['version'] ?? 4)}`]
    if (extra['reuse'] !== undefined) fields.push(`reuse=${Boolean(extra['reuse'])}`)
    if (extra['udp'] !== undefined) fields.push(`udp-relay=${Boolean(extra['udp'])}`)
    const obfs = String(extra['obfs'] ?? '')
    if (obfs === 'http') {
      fields.push('obfs=http')
      if (extra['obfsHost']) fields.push(`obfs-host=${String(extra['obfsHost'])}`)
    }
    return `${name} = snell, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'trusttunnel') {
    const username = String(extra['username'] ?? '')
    if (!username || !password) return null
    return `${name} = trust-tunnel, ${server}, ${port}, ${[
      `username=${username}`,
      `password=${password}`,
      ...surgeTlsFields(parsed, extra),
    ].join(', ')}`
  }
  if (protocol === 'http' || protocol === 'https' || protocol === 'socks5') {
    const username = String(extra['username'] ?? '')
    const fields = username || password ? [username, password] : []
    if (protocol === 'https') fields.push(...surgeTlsFields(parsed, extra))
    if (protocol === 'socks5' && extra['udp'] !== undefined) {
      fields.push(`udp-relay=${Boolean(extra['udp'])}`)
    }
    return `${prefix}${fields.length > 0 ? `, ${fields.join(', ')}` : ''}`
  }
  return null
}

function surgeWebSocketFields(parsed: Row): string[] {
  if (String(parsed['network'] ?? 'tcp') !== 'ws') return []
  const fields = ['ws=true']
  const extra = asRecord(parsed['extra'])
  const path = String(parsed['wsPath'] ?? extra['wsPath'] ?? '')
  if (path) fields.push(`ws-path=${path}`)
  const headers = asRecord(parsed['wsHeaders'])
  const serializedHeaders = Object.entries(headers)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(';')
  if (serializedHeaders) fields.push(`ws-headers=${serializedHeaders}`)
  return fields
}

function surgeTlsFields(parsed: Row, extra: Row): string[] {
  const fields: string[] = []
  const sni = String(parsed['sni'] ?? '')
  if (sni) fields.push(`sni=${sni}`)
  if (parsed['skipCertVerify']) fields.push('skip-cert-verify=true')
  const alpn = Array.isArray(extra['alpn']) ? extra['alpn'].map(String).filter(Boolean) : []
  if (alpn.length === 1) fields.push(`alpn=${alpn[0]}`)
  return fields
}

function surgeAuxiliarySections(nodes: Row[]): string[] {
  const lines: string[] = []
  const sshKeys: string[] = []
  for (const node of nodes) {
    const protocol = String(node['protocol'] ?? '')
    const parsed = safeJson(node['parsed_config'])
    const extra = asRecord(parsed['extra'])
    if (protocol === 'wireguard') {
      const section = surgeWireGuardSectionLines(node, extra)
      if (section.length > 0) {
        if (lines.length > 0) lines.push('')
        lines.push(...section)
      }
    }
    if (protocol === 'ssh' && !parsed['password']) {
      const privateKey = String(extra['privateKey'] ?? extra['private-key'] ?? '')
      if (privateKey) {
        sshKeys.push(
          `${surgeSshKeyName(node)} = type=openssh-private-key, base64=${encodeBase64Utf8(privateKey)}`,
        )
      }
    }
  }
  if (sshKeys.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('[Keystore]', ...sshKeys)
  }
  return lines
}

function surgeWireGuardSectionLines(node: Row, extra: Row): string[] {
  const privateKey = String(extra['privateKey'] ?? extra['private-key'] ?? '')
  const publicKey = String(extra['publicKey'] ?? extra['public-key'] ?? '')
  const addresses = configStringArray(extra['ip'] ?? extra['localAddress'])
  const ipv4 = addresses.find((address) => !address.includes(':'))?.split('/', 1)[0]
  const ipv6 = addresses.find((address) => address.includes(':'))?.split('/', 1)[0]
  if (!privateKey || !publicKey || (!ipv4 && !ipv6)) return []
  const allowedIps = configStringArray(extra['allowedIPs'] ?? extra['allowedIps'] ?? extra['allowed_ips'])
  const peerFields = [
    `public-key = ${publicKey}`,
    `allowed-ips = ${quoteIniValue(allowedIps.join(', ') || '0.0.0.0/0')}`,
    `endpoint = ${String(node['server'] ?? '')}:${Number(node['port'] ?? 0)}`,
  ]
  const presharedKey = extra['presharedKey'] ?? extra['pre-shared-key']
  if (presharedKey) peerFields.push(`preshared-key = ${String(presharedKey)}`)
  if (extra['keepalive'] !== undefined) peerFields.push(`keepalive = ${Number(extra['keepalive'])}`)
  const reserved = normalizeReservedBytes(extra['reserved'])
  if (reserved) peerFields.push(`client-id = ${reserved.join('/')}`)
  const lines = [
    `[WireGuard ${surgeWireGuardSectionName(node)}]`,
    `private-key = ${privateKey}`,
  ]
  if (ipv4) lines.push(`self-ip = ${ipv4}`)
  if (ipv6) lines.push(`self-ip-v6 = ${ipv6}`)
  const dns = configStringArray(extra['dns'])
  if (dns.length > 0) lines.push(`dns-server = ${dns.join(', ')}`)
  if (extra['mtu'] !== undefined) lines.push(`mtu = ${Number(extra['mtu'])}`)
  lines.push(`peer = (${peerFields.join(', ')})`)
  return lines
}

function surgeWireGuardSectionName(node: Row): string {
  return `wg_${safeTag(String(node['id'] ?? node['name'] ?? 'node'))}`
}

function surgeSshKeyName(node: Row): string {
  return `ssh_${safeTag(String(node['id'] ?? node['name'] ?? 'node'))}`
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function quoteIniValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function configStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function normalizeReservedBytes(value: unknown): number[] | undefined {
  const bytes = Array.isArray(value)
    ? value.map(Number)
    : typeof value === 'string'
      ? value.split(',').map((item) => Number(item.trim()))
      : []
  return bytes.length === 3 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? bytes
    : undefined
}

function nodeToShadowrocketProxy(node: Row): string | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = asRecord(parsed['extra'])
  if (!name || !server || !port) return null

  if (protocol === 'ss') {
    const method = String(extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm')
    return `${name} = ss, ${server}, ${port}, encrypt-method=${method}, password=${parsed['password'] ?? ''}`
  }
  if (protocol === 'ssr') {
    const method = String(extra['cipher'] ?? extra['method'] ?? 'aes-256-cfb')
    const fields = [
      `method=${method}`,
      `password=${String(parsed['password'] ?? '')}`,
      `protocol=${String(extra['protocol'] ?? 'origin')}`,
      `obfs=${String(extra['obfs'] ?? 'plain')}`,
    ]
    if (extra['protocolParam']) fields.push(`protocol-param=${String(extra['protocolParam'])}`)
    if (extra['obfsParam']) fields.push(`obfs-param=${String(extra['obfsParam'])}`)
    return `${name} = ssr, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'vmess') {
    const tls = parsed['tls'] ? ', tls=true' : ''
    const sni = parsed['sni'] ? `, sni=${parsed['sni']}` : ''
    return `${name} = vmess, ${server}, ${port}, username=${parsed['uuid'] ?? ''}${tls}${sni}`
  }
  if (protocol === 'vless') {
    if (!parsed['uuid']) return null
    const fields = [`password=${String(parsed['uuid'] ?? '')}`]
    if (parsed['tls']) fields.push('tls=true')
    if (String(parsed['network'] ?? 'tcp') === 'ws') {
      fields.push('obfs=websocket')
      const host = quantumultXHost(parsed)
      if (host) fields.push(`obfs-host=${host}`)
      const path = String(parsed['wsPath'] ?? extra['wsPath'] ?? '')
      if (path) fields.push(`obfs-uri=${path}`)
    }
    if (parsed['sni']) fields.push(`peer=${String(parsed['sni'])}`)
    if (parsed['skipCertVerify']) fields.push('allowInsecure=1')
    if (extra['flow']) fields.push(`flow=${String(extra['flow'])}`)
    const publicKey = extra['realityPublicKey'] ?? extra['publicKey'] ?? extra['pbk']
    const shortId = extra['realityShortId'] ?? extra['shortId'] ?? extra['sid']
    if (publicKey) fields.push(`public-key=${String(publicKey)}`)
    if (shortId) fields.push(`short-id=${String(shortId)}`)
    return `${name} = vless, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'trojan') {
    const sni = parsed['sni'] ? `, sni=${parsed['sni']}` : ''
    return `${name} = trojan, ${server}, ${port}, password=${parsed['password'] ?? ''}${sni}`
  }
  if (protocol === 'anytls') {
    const sni = parsed['sni'] ? `, sni=${parsed['sni']}` : ''
    const fingerprint = extra['client-fingerprint'] ?? extra['clientFingerprint'] ?? extra['fingerprint'] ?? extra['fp']
    const fp = fingerprint ? `, client-fingerprint=${fingerprint}` : ''
    const udp = extra['udp'] !== undefined ? `, udp-relay=${Boolean(extra['udp'])}` : ''
    const alpn = Array.isArray(extra['alpn']) ? `, alpn=${extra['alpn'].map(String).join('|')}` : ''
    return `${name} = anytls, ${server}, ${port}, password=${parsed['password'] ?? ''}${sni}${fp}${udp}${alpn}`
  }
  if (protocol === 'hysteria' || protocol === 'hysteria2') {
    const auth = String(parsed['password'] ?? extra['auth'] ?? extra['authStr'] ?? '')
    if (!auth) return null
    const fields = [`auth=${auth}`]
    if (extra['obfsPassword']) fields.push(`obfsParam=${String(extra['obfsPassword'])}`)
    if (protocol === 'hysteria' && extra['protocol']) fields.push(`protocol=${String(extra['protocol'])}`)
    if (extra['udp'] !== undefined) fields.push(`udp=${extra['udp'] ? 1 : 0}`)
    if (parsed['sni']) fields.push(`peer=${String(parsed['sni'])}`)
    if (parsed['skipCertVerify']) fields.push('insecure=1')
    const alpn = configStringArray(extra['alpn'])
    if (alpn.length > 0) fields.push(`alpn=${alpn.join('|')}`)
    if (extra['upMbps'] !== undefined) fields.push(`upmbps=${Number(extra['upMbps'])}`)
    if (extra['downMbps'] !== undefined) fields.push(`downmbps=${Number(extra['downMbps'])}`)
    return `${name} = ${protocol}, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'tuic') {
    if (!parsed['uuid'] || !parsed['password']) return null
    const fields = [
      `user=${String(parsed['uuid'] ?? '')}`,
      `password=${String(parsed['password'] ?? '')}`,
      `udp=${extra['udp'] === false ? 0 : 1}`,
    ]
    if (parsed['sni']) fields.push(`peer=${String(parsed['sni'])}`)
    if (parsed['skipCertVerify']) fields.push('insecure=1')
    const alpn = configStringArray(extra['alpn'])
    fields.push(`alpn=${alpn[0] ?? 'h3'}`)
    return `${name} = tuic, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'wireguard') {
    const privateKey = String(extra['privateKey'] ?? extra['private-key'] ?? '')
    const publicKey = String(extra['publicKey'] ?? extra['public-key'] ?? '')
    const addresses = configStringArray(extra['ip'] ?? extra['localAddress'])
    if (!privateKey || !publicKey || addresses.length === 0) return null
    const fields = [
      `privateKey=${privateKey}`,
      `publicKey=${publicKey}`,
      `ip=${addresses.join('|')}`,
      `udp=${extra['udp'] === false ? 0 : 1}`,
    ]
    const presharedKey = extra['presharedKey'] ?? extra['pre-shared-key']
    if (presharedKey) fields.push(`presharedKey=${String(presharedKey)}`)
    const dns = configStringArray(extra['dns'])
    if (dns.length > 0) fields.push(`dns=${dns.join('|')}`)
    if (extra['mtu'] !== undefined) fields.push(`mtu=${Number(extra['mtu'])}`)
    if (extra['keepalive'] !== undefined) fields.push(`keepalive=${Number(extra['keepalive'])}`)
    const reserved = normalizeReservedBytes(extra['reserved'])
    if (reserved) fields.push(`reserved=${reserved.join('/')}`)
    return `${name} = wireguard, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'ssh') {
    const username = String(extra['username'] ?? extra['user'] ?? '')
    const privateKey = extra['privateKey'] ?? extra['private-key']
    if (!username || (!parsed['password'] && !privateKey)) return null
    const fields = [`user=${username}`]
    if (parsed['password']) fields.push(`password=${String(parsed['password'])}`)
    if (privateKey) {
      fields.push(`private-key=${quoteIniValue(String(privateKey))}`)
    }
    return `${name} = ssh, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'snell') {
    const psk = String(extra['psk'] ?? parsed['password'] ?? '')
    if (!psk) return null
    const fields = [
      `password=${psk}`,
      `version=${Number(extra['version'] ?? 4)}`,
      `udp=${extra['udp'] === false ? 0 : 1}`,
    ]
    const obfs = String(extra['obfs'] ?? '')
    if (obfs) fields.push(`obfs=${obfs}`)
    if (extra['obfsHost']) fields.push(`obfs-host=${String(extra['obfsHost'])}`)
    return `${name} = snell, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'mieru') {
    const username = String(extra['username'] ?? '')
    const password = String(parsed['password'] ?? extra['password'] ?? '')
    if (!username || !password) return null
    return `${name} = mieru, ${server}, ${port}, ${[
      `username=${username}`,
      `password=${password}`,
      `transport=${String(extra['transport'] ?? 'TCP').toUpperCase()}`,
      `multiplexing=${String(extra['multiplexing'] ?? 'MULTIPLEXING_LOW')}`,
    ].join(', ')}`
  }
  if (protocol === 'juicity') {
    const uuid = String(parsed['uuid'] ?? '')
    const password = String(parsed['password'] ?? '')
    if (!uuid || !password) return null
    const fields = [`user=${uuid}`, `password=${password}`, 'udp=1']
    if (parsed['sni']) fields.push(`peer=${String(parsed['sni'])}`)
    if (parsed['skipCertVerify']) fields.push('insecure=1')
    const alpn = configStringArray(extra['alpn'])
    fields.push(`alpn=${alpn[0] ?? 'h3'}`)
    return `${name} = juicity, ${server}, ${port}, ${fields.join(', ')}`
  }
  if (protocol === 'http' || protocol === 'https') {
    const tls = protocol === 'https' || parsed['tls'] ? ', tls=true' : ''
    return `${name} = http, ${server}, ${port}${tls}`
  }
  if (protocol === 'socks5') {
    return `${name} = socks5, ${server}, ${port}`
  }
  return null
}

/**
 * Quantumult X profiles require native entries in [server_local]. Generic
 * subscription URIs may be accepted by import screens, but are not profile
 * syntax and therefore must not be embedded here.
 */
function nodeToQuantumultX(node: Row): string | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = asRecord(parsed['extra'])
  if (!name || !server || !port) return null

  const endpoint = `${server}:${port}`
  const password = String(parsed['password'] ?? '')
  const username = String(extra['username'] ?? '')
  const uuid = String(parsed['uuid'] ?? '')
  const udpRelay = `udp-relay=${Boolean(extra['udp'] ?? true)}`
  const tag = `tag=${name}`

  if (protocol === 'ss' || protocol === 'ssr') {
    const method = String(extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm')
    const fields = [`shadowsocks=${endpoint}`, `method=${method}`, `password=${password}`]
    if (protocol === 'ssr') {
      fields.push(`ssr-protocol=${String(extra['protocol'] ?? 'origin')}`, `obfs=${String(extra['obfs'] ?? 'plain')}`)
      if (extra['protocolParam']) fields.push(`ssr-protocol-param=${String(extra['protocolParam'])}`)
      if (extra['obfsParam']) fields.push(`obfs-host=${String(extra['obfsParam'])}`)
    }
    return [...fields, udpRelay, tag].join(', ')
  }

  if (protocol === 'vmess' || protocol === 'vless') {
    const fields = [
      `${protocol}=${endpoint}`,
      `method=${protocol === 'vless' ? 'none' : String(extra['cipher'] ?? 'none')}`,
      `password=${uuid}`,
      ...quantumultXTransportFields(parsed, extra),
      udpRelay,
      tag,
    ]
    return fields.join(', ')
  }

  if (protocol === 'trojan' || protocol === 'anytls') {
    return [
      `${protocol}=${endpoint}`,
      `password=${password}`,
      'over-tls=true',
      ...quantumultXTlsFields(parsed, extra),
      udpRelay,
      tag,
    ].join(', ')
  }

  if (protocol === 'http' || protocol === 'https' || protocol === 'socks5') {
    const fields = [`${protocol === 'socks5' ? 'socks5' : 'http'}=${endpoint}`]
    if (username) fields.push(`username=${username}`)
    if (password) fields.push(`password=${password}`)
    if (protocol === 'https' || parsed['tls']) {
      fields.push('over-tls=true', ...quantumultXTlsFields(parsed, extra))
    }
    fields.push(udpRelay, tag)
    return fields.join(', ')
  }

  return null
}

function quantumultXTransportFields(parsed: Row, extra: Row): string[] {
  const network = String(parsed['network'] ?? 'tcp')
  const tls = Boolean(parsed['tls'])
  const fields: string[] = []
  if (network === 'ws') {
    fields.push(`obfs=${tls ? 'wss' : 'ws'}`)
    const host = quantumultXHost(parsed)
    if (host) fields.push(`obfs-host=${host}`)
    const path = String(parsed['wsPath'] ?? extra['wsPath'] ?? '')
    if (path) fields.push(`obfs-uri=${path}`)
  } else if (tls) {
    fields.push('obfs=over-tls')
    const host = String(parsed['sni'] ?? '')
    if (host) fields.push(`obfs-host=${host}`)
  }
  fields.push(...quantumultXRealityFields(extra))
  if (tls || network === 'ws') {
    fields.push(`tls-verification=${!parsed['skipCertVerify']}`)
  }
  return fields
}

function quantumultXTlsFields(parsed: Row, extra: Row): string[] {
  const fields: string[] = []
  const sni = String(parsed['sni'] ?? '')
  if (sni) fields.push(`tls-host=${sni}`)
  fields.push(...quantumultXRealityFields(extra))
  fields.push(`tls-verification=${!parsed['skipCertVerify']}`)
  return fields
}

function quantumultXRealityFields(extra: Row): string[] {
  const publicKey = extra['realityPublicKey'] ?? extra['publicKey'] ?? extra['pbk']
  const shortId = extra['realityShortId'] ?? extra['shortId'] ?? extra['sid']
  const fields: string[] = []
  if (publicKey) fields.push(`reality-base64-pubkey=${String(publicKey)}`)
  if (shortId) fields.push(`reality-hex-shortid=${String(shortId)}`)
  if (extra['flow']) fields.push(`vless-flow=${String(extra['flow'])}`)
  return fields
}

function quantumultXHost(parsed: Row): string {
  const headers = asRecord(parsed['wsHeaders'])
  return String(headers['Host'] ?? headers['host'] ?? parsed['sni'] ?? '')
}

function groupToIni(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>,
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames)
  if (type === 'url-test')
    return `${name} = url-test, ${members.join(', ')}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'fallback')
    return `${name} = fallback, ${members.join(', ')}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'load-balance') return `${name} = load-balance, ${members.join(', ')}`
  return `${name} = select, ${members.join(', ')}`
}

function groupToQuantumultX(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>,
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames).join(',')
  if (type === 'url-test')
    return `url-latency-benchmark=${name}, ${members}, check-interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'fallback')
    return `available=${name}, ${members}`
  if (type === 'load-balance')
    return `round-robin=${name}, ${members}`
  return `static=${name}, ${members}`
}

function groupToEgern(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>,
): Record<string, unknown> {
  const type = String(group['type'] ?? 'select')
  const nativeType = type === 'url-test' ? 'auto_test' : type === 'load-balance' ? 'load_balance' : type
  const body: Record<string, unknown> = {
    name: String(group['name'] ?? ''),
    policies: collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames),
    latency_test_url: group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl,
  }
  if (['auto_test', 'fallback', 'load_balance'].includes(nativeType)) {
    body['interval'] = Number(group['interval'] ?? DEFAULT_HEALTH_CHECK.interval)
  }
  if (nativeType === 'auto_test' && group['tolerance'] !== undefined) {
    body['tolerance'] = Number(group['tolerance'])
  }
  return {
    [nativeType]: body,
  }
}

function ruleToIni(rule: Row, groups: Row[], client: 'surge' | 'shadowrocket', forceRemoteDns = false): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const targetGroupId = String(rule['target_group_id'] ?? '')
  const target = resolveGroupName(targetGroupId, groups)
  const noResolve =
    rule['no_resolve'] && getRuleNoResolveHandling(type as RuleCompatibilityType, client) === 'native'
      ? ',no-resolve'
      : ''
  if (type === 'MATCH') return `FINAL,${target}`
  const resolution = resolveRuleForExport(type as RuleCompatibilityType, payload, client)
  if (resolution.level === 'unsupported') return null
  const targetGroupType = String(groups.find((group) => String(group['id']) === targetGroupId)?.['type'] ?? '')
  const remoteDns =
    forceRemoteDns &&
    client === 'shadowrocket' &&
    ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX'].includes(resolution.type) &&
    !['direct', 'reject'].includes(targetGroupType)
      ? ',force-remote-dns'
      : ''
  return `${resolution.type},${resolution.payload},${target}${noResolve}${remoteDns}`
}

function ruleToQuantumultX(rule: Row, groups: Row[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const target = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  if (type === 'MATCH') return `FINAL,${target}`
  const resolution = resolveRuleForExport(type as RuleCompatibilityType, payload, 'quantumultx')
  if (resolution.level === 'unsupported') return null
  return `${resolution.type},${resolution.payload},${target}`
}

function ruleToEgern(rule: Row, groups: Row[]): Record<string, unknown> | null {
  const sourceType = String(rule['type'] ?? '')
  const sourcePayload = String(rule['payload'] ?? '')
  const policy = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const resolution = resolveRuleForExport(sourceType as RuleCompatibilityType, sourcePayload, 'egern')
  if (resolution.level === 'unsupported') return null
  const type = resolution.type
  const payload = resolution.payload
  const map: Record<string, string> = {
    DOMAIN: 'domain',
    'DOMAIN-SUFFIX': 'domain_suffix',
    'DOMAIN-KEYWORD': 'domain_keyword',
    'DOMAIN-REGEX': 'domain_regex',
    'IP-CIDR': 'ip_cidr',
    'IP-CIDR6': 'ip_cidr6',
    'IP-ASN': 'asn',
    GEOIP: 'geoip',
    PORT: 'dest_port',
    PROTOCOL: 'protocol',
    NETWORK: 'protocol',
    'RULE-SET': 'rule_set',
    MATCH: 'default',
  }
  const key = map[type]
  if (!key) return null
  if (type === 'MATCH') return { default: { policy } }
  return {
    [key]: {
      match: payload,
      policy,
      ...(getRuleNoResolveHandling(sourceType as RuleCompatibilityType, 'egern') === 'native' && rule['no_resolve']
        ? { no_resolve: true }
        : {}),
    },
  }
}

function nodeToEgernProxy(node: Row): Record<string, unknown> | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = asRecord(parsed['extra'])
  if (!name || !server || !port) return null
  if (!isEgernTransportSupported(protocol, parsed['network'])) return null
  const common = { name, server, port }
  const password = String(parsed['password'] ?? '')
  const username = String(extra['username'] ?? '')
  if (protocol === 'ss') {
    return {
      shadowsocks: compactObject({
        ...common,
        method: extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm',
        password,
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
        obfs: ['http', 'tls'].includes(String(extra['obfs'] ?? '')) ? extra['obfs'] : undefined,
        obfs_host: extra['obfsHost'] ?? extra['obfsParam'],
        obfs_uri: extra['obfsUri'],
      }),
    }
  }
  if (protocol === 'vmess') {
    return {
      vmess: compactObject({
        ...common,
        user_id: String(parsed['uuid'] ?? ''),
        security: normalizeEgernVmessSecurity(extra['cipher']),
        legacy: optionalBoolean(extra['legacy']),
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
        transport: egernVmessTransport(parsed, extra),
      }),
    }
  }
  if (protocol === 'vless') {
    return {
      vless: compactObject({
        ...common,
        user_id: String(parsed['uuid'] ?? ''),
        flow: extra['flow'],
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
        transport: egernVmessTransport(parsed, extra),
      }),
    }
  }
  if (protocol === 'trojan') {
    const websocket =
      String(parsed['network'] ?? 'tcp') === 'ws'
        ? compactObject({
            path: parsed['wsPath'] ?? extra['wsPath'] ?? '/',
            host: egernWebSocketHost(parsed),
          })
        : undefined
    return {
      trojan: compactObject({
        ...common,
        password,
        sni: parsed['sni'],
        skip_tls_verify: optionalBoolean(parsed['skipCertVerify']),
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
        websocket,
      }),
    }
  }
  if (protocol === 'anytls') {
    return {
      anytls: compactObject({
        ...common,
        password,
        sni: parsed['sni'],
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
        skip_tls_verify: optionalBoolean(parsed['skipCertVerify']),
        fingerprint_sha256: extra['fingerprintSha256'] ?? extra['fingerprint_sha256'],
      }),
    }
  }
  if (protocol === 'hysteria2') {
    return {
      hysteria2: compactObject({
        ...common,
        auth: password || extra['auth'],
        sni: parsed['sni'],
        obfs: extra['obfs'],
        obfs_password: extra['obfsPassword'],
        skip_tls_verify: optionalBoolean(parsed['skipCertVerify']),
        fingerprint_sha256: extra['fingerprintSha256'] ?? extra['fingerprint_sha256'],
        port_hopping: extra['ports'] ?? extra['portHopping'],
        port_hopping_interval: extra['portHoppingInterval'],
        bandwidth: extra['upMbps'],
      }),
    }
  }
  if (protocol === 'tuic') {
    return {
      tuic: compactObject({
        ...common,
        uuid: String(parsed['uuid'] ?? ''),
        password,
        udp_relay_mode: extra['udpRelayMode'] ?? extra['udp_relay_mode'],
        alpn: Array.isArray(extra['alpn']) ? extra['alpn'].map(String).filter(Boolean) : undefined,
        sni: parsed['sni'],
        skip_tls_verify: optionalBoolean(parsed['skipCertVerify']),
        fingerprint_sha256: extra['fingerprintSha256'] ?? extra['fingerprint_sha256'],
        port_hopping: extra['ports'] ?? extra['portHopping'],
        port_hopping_interval: extra['portHoppingInterval'],
      }),
    }
  }
  if (protocol === 'http' || protocol === 'https') {
    const nativeType = protocol === 'https' || parsed['tls'] ? 'https' : 'http'
    return {
      [nativeType]: compactObject({
        ...common,
        username: username || undefined,
        password: password || undefined,
        sni: nativeType === 'https' ? parsed['sni'] : undefined,
        skip_tls_verify: nativeType === 'https' ? optionalBoolean(parsed['skipCertVerify']) : undefined,
        tfo: optionalBoolean(extra['fastOpen']),
      }),
    }
  }
  if (protocol === 'socks5') {
    const nativeType = parsed['tls'] ? 'socks5_tls' : 'socks5'
    return {
      [nativeType]: compactObject({
        ...common,
        username: username || undefined,
        password: password || undefined,
        sni: parsed['tls'] ? parsed['sni'] : undefined,
        skip_tls_verify: parsed['tls'] ? optionalBoolean(parsed['skipCertVerify']) : undefined,
        tfo: optionalBoolean(extra['fastOpen']),
        udp_relay: optionalBoolean(extra['udp']),
      }),
    }
  }
  if (protocol === 'ssh') {
    return {
      ssh: compactObject({
        ...common,
        username: username || extra['user'],
        password: password || undefined,
        private_key: extra['privateKey'] ?? extra['private_key'],
        host_keys: Array.isArray(extra['hostKeys']) ? extra['hostKeys'].map(String) : undefined,
        tfo: optionalBoolean(extra['fastOpen']),
      }),
    }
  }
  if (protocol === 'wireguard') {
    const localAddress = String(extra['ip'] ?? extra['localAddress'] ?? '')
    return {
      wireguard: compactObject({
        ...common,
        private_key: extra['privateKey'] ?? extra['private-key'],
        peer_public_key: extra['publicKey'] ?? extra['public-key'],
        preshared_key: extra['presharedKey'] ?? extra['pre-shared-key'],
        local_ipv4: localAddress.includes(':') ? undefined : localAddress || undefined,
        local_ipv6: localAddress.includes(':') ? localAddress : undefined,
        reserved: normalizeEgernReserved(extra['reserved']),
        mtu: extra['mtu'],
        keepalive: extra['keepalive'],
      }),
    }
  }
  if (protocol === 'snell') {
    const psk = String(extra['psk'] ?? password)
    if (!psk) return null
    return {
      snell: compactObject({
        ...common,
        psk,
        version: Number(extra['version'] ?? 4),
        udp_relay: optionalBoolean(extra['udp']),
        reuse: optionalBoolean(extra['reuse']),
        obfs: extra['obfs'],
        obfs_host: extra['obfsHost'],
        tfo: optionalBoolean(extra['fastOpen']),
      }),
    }
  }
  return null
}

function egernEntryName(entry: Record<string, unknown>): string {
  const body = asRecord(Object.values(entry)[0])
  return String(body['name'] ?? '')
}

function egernVmessTransport(parsed: Row, extra: Row): Record<string, unknown> | undefined {
  const network = String(parsed['network'] ?? 'tcp')
  const tls = Boolean(parsed['tls'])
  const tlsFields = compactObject({
    sni: parsed['sni'],
    skip_tls_verify: optionalBoolean(parsed['skipCertVerify']),
    fingerprint_sha256: extra['fingerprintSha256'] ?? extra['fingerprint_sha256'],
    reality: egernReality(extra),
  })
  if (network === 'tcp') return tls ? { tls: tlsFields } : undefined
  if (network === 'ws') {
    return {
      [tls ? 'wss' : 'ws']: compactObject({
        path: parsed['wsPath'] ?? extra['wsPath'] ?? '/',
        headers: Object.keys(asRecord(parsed['wsHeaders'])).length > 0 ? asRecord(parsed['wsHeaders']) : undefined,
        ...tlsFields,
      }),
    }
  }
  if (network === 'http' || network === 'h2') {
    return {
      [network === 'http' ? 'http1' : 'http2']: compactObject({
        method: extra['httpMethod'] ?? 'GET',
        path: parsed['wsPath'] ?? extra['wsPath'] ?? '/',
        headers: Object.keys(asRecord(parsed['wsHeaders'])).length > 0 ? asRecord(parsed['wsHeaders']) : undefined,
        ...(network === 'h2' ? tlsFields : {}),
      }),
    }
  }
  if (network === 'grpc') {
    return {
      grpc: compactObject({
        service_name: extra['grpcServiceName'] ?? extra['serviceName'] ?? parsed['wsPath'],
        user_agent: extra['grpcUserAgent'],
        ...tlsFields,
      }),
    }
  }
  return undefined
}

function egernReality(extra: Row): Record<string, unknown> | undefined {
  const publicKey = extra['publicKey'] ?? extra['realityPublicKey']
  if (!publicKey) return undefined
  return compactObject({
    public_key: publicKey,
    short_id: extra['shortId'] ?? extra['realityShortId'],
  })
}

function egernWebSocketHost(parsed: Row): string | undefined {
  const headers = asRecord(parsed['wsHeaders'])
  const host = headers['Host'] ?? headers['host']
  return host ? String(host) : undefined
}

function normalizeEgernVmessSecurity(value: unknown): string {
  const security = String(value ?? 'auto')
  return ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'].includes(security) ? security : 'auto'
}

function normalizeEgernReserved(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const bytes = value.map(Number)
    return bytes.length === 3 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? bytes
      : undefined
  }
  if (typeof value === 'string') {
    const bytes = value.split(',').map((item) => Number(item.trim()))
    return bytes.length === 3 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? bytes
      : undefined
  }
  return undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value)
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function resolveGroupName(groupId: string, groups: Row[]): string {
  const group = groups.find((item) => String(item['id']) === groupId)
  return group ? nativePolicyName(group) : groupId || defaultPolicy(groups)
}

function exportPolicyGroups(groups: Row[]): Row[] {
  return groups.filter((group) => !isNativeOutletGroup(group))
}

function collectClientGroupMembers(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>,
): string[] {
  return collectGroupMembers(group, groups, nodeNames, collectionNodeNames, nativePolicyName)
}

function nativePolicyName(group: Row): string {
  const type = String(group['type'] ?? '')
  if (type === 'direct') return 'DIRECT'
  if (type === 'reject') return 'REJECT'
  return String(group['name'] ?? '')
}

function isNativeOutletGroup(group: Row): boolean {
  return ['direct', 'reject'].includes(String(group['type'] ?? ''))
}

function defaultPolicy(groups: Row[]): string {
  const group = groups.find((item) => isWorkspaceEntityId(String(item['id']), DEFAULT_RULE_TARGET_GROUP_ID))
  return group ? nativePolicyName(group) : 'DIRECT'
}

function hasEnabledMatchRule(rules: Row[]): boolean {
  return rules.some((rule) => Boolean(rule['enabled']) && String(rule['type']) === 'MATCH')
}

function sortRemoteRuleSetRows(remoteSets: Row[]): Row[] {
  return [...remoteSets].sort(
    (a, b) =>
      Number(a['sort_order'] ?? 500) - Number(b['sort_order'] ?? 500) ||
      String(a['created_at'] ?? '').localeCompare(String(b['created_at'] ?? '')),
  )
}

function safeJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function safeTag(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}
