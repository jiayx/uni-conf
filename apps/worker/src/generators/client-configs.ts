import * as yaml from 'js-yaml'
import {
  DEFAULT_HEALTH_CHECK,
  getRuleCompatibilityLevel,
  isEgernTransportSupported,
  isRuleSetFormatCompatible,
  resolveRuleForExport,
  supportsRuleNoResolve,
} from '@uni-conf/shared'
import { generateMihomoYaml } from './mihomo'
import { collectGroupMembers } from './group-members'
import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'
import type { DnsMode, ProxyGroup, ProxyNode, ProxyRule, RemoteRuleSet } from '@uni-conf/types'

type Row = Record<string, unknown>
type RuleCompatibilityType = Parameters<typeof getRuleCompatibilityLevel>[0]

export function generateStashYaml(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  collectionNodeNames: Record<string, string[]> = {},
  options: { dnsMode?: DnsMode; ruleSetConversionBaseUrl?: string } = {}
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
  options: { ruleSetConversionBaseUrl?: string } = {}
): string {
  const lines = buildIniConfig({
    client: 'surge',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
    ruleSetConversionBaseUrl: options.ruleSetConversionBaseUrl,
    general: [
      '[General]',
      'loglevel = notify',
      'internet-test-url = http://connectivitycheck.gstatic.com/generate_204',
      `proxy-test-url = ${DEFAULT_HEALTH_CHECK.testUrl}`,
      'test-timeout = 5',
      '',
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
  options: { ruleSetConversionBaseUrl?: string } = {}
): string {
  const lines = buildIniConfig({
    client: 'shadowrocket',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
    ruleSetConversionBaseUrl: options.ruleSetConversionBaseUrl,
    general: [
      '[General]',
      'bypass-system = true',
      'dns-server = system, 223.5.5.5, 8.8.8.8',
      'skip-proxy = 127.0.0.1, localhost, *.local',
      '',
    ],
    remoteSection: '[Remote Rule]',
  })
  return lines.join('\n')
}

export function generateQuantumultX(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: { ruleSetConversionBaseUrl?: string } = {}
): string {
  const serializedNodes = nodes
    .map((node) => ({ node, line: nodeToQuantumultX(node) }))
    .filter((item): item is { node: Row; line: string } => item.line !== null)
  const nodeLines = serializedNodes.map((item) => item.line)
  const nodeNames = serializedNodes.map((item) => String(item.node['name'] ?? '')).filter(Boolean)
  const lines: string[] = [
    '[general]',
    `server_check_url=${DEFAULT_HEALTH_CHECK.testUrl}`,
    'network_check_url=http://connectivitycheck.gstatic.com/generate_204',
    '',
    '[server_local]',
    ...nodeLines,
    '',
    '[policy]',
  ]
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)

  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToQuantumultX(group, groups, nodeNames, collectionNodeNames))
  }

  lines.push('', '[filter_remote]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'quantumultx', options.ruleSetConversionBaseUrl)
    if (!resolved || !isRuleSetFormatCompatible('quantumultx', resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`${resolved.url}, tag=${rs['name']}, force-policy=${target}, enabled=true`)
  }

  lines.push('', '[filter_local]')
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToQuantumultX(rule, groups)
    if (line) lines.push(line)
  }
  if (!hasEnabledMatchRule(rules)) {
    lines.push(`FINAL,${defaultPolicy(groups)}`)
  }
  lines.push('')

  return lines.join('\n')
}

export function generateEgern(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {},
  options: { ruleSetConversionBaseUrl?: string } = {}
): string {
  const proxies = nodes
    .map(nodeToEgernProxy)
    .filter((proxy): proxy is Record<string, unknown> => proxy !== null)
  const nodeNames = proxies.map(egernEntryName).filter(Boolean)
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)
  const remoteRules = sortedRemoteSets
    .filter((rs) => rs['enabled'])
    .map((rs) => ({ source: rs, resolved: resolveRemoteRuleSetRowForExport(rs, 'egern', options.ruleSetConversionBaseUrl) }))
    .filter((item): item is { source: Row; resolved: { url: string; format: string } } =>
      Boolean(item.resolved) && isRuleSetFormatCompatible('egern', item.resolved!.format)
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

  const config = {
    auto_update: { interval: 86400 },
    ipv6: false,
    http_port: 3080,
    socks_port: 3081,
    proxies,
    policy_groups: exportPolicyGroups(groups)
      .map((group) => groupToEgern(group, groups, nodeNames, collectionNodeNames)),
    rules: [
      ...remoteRules,
      ...localRules,
      ...(hasDefaultRule ? [] : [{ default: { policy: defaultPolicy(groups) } }]),
    ],
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
  remoteSection,
}: {
  client: 'surge' | 'shadowrocket'
  nodes: Row[]
  groups: Row[]
  rules: Row[]
  remoteSets: Row[]
  collectionNodeNames: Record<string, string[]>
  ruleSetConversionBaseUrl?: string
  general: string[]
  remoteSection?: string
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

  lines.push('', '[Proxy Group]')
  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToIni(group, groups, validNodes, collectionNodeNames))
  }

  if (remoteSection) {
    lines.push('', remoteSection)
    for (const rs of sortedRemoteSets) {
      if (!rs['enabled']) continue
      const resolved = resolveRemoteRuleSetRowForExport(rs, client, ruleSetConversionBaseUrl)
      if (!resolved || !isRuleSetFormatCompatible(client, resolved.format)) continue
      const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
      lines.push(`${safeTag(String(rs['name'] ?? 'remote'))} = ${resolved.url}, policy=${target}, update-interval=${Number(rs['update_interval'] ?? 24) * 3600}`)
    }
  }

  lines.push('', '[Rule]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, client, ruleSetConversionBaseUrl)
    if (!resolved || !isRuleSetFormatCompatible(client, resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    const source = client === 'surge'
      ? resolved.url
      : safeTag(String(rs['name'] ?? 'remote'))
    lines.push(`RULE-SET,${source},${target}`)
  }
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToIni(rule, groups, client)
    if (line) lines.push(line)
  }
  if (!hasEnabledMatchRule(rules)) {
    lines.push(`FINAL,${defaultPolicy(groups)}`)
  }
  lines.push('')

  return lines
}

function nodeToIniProxy(node: Row, client: 'surge' | 'shadowrocket'): string | null {
  return client === 'surge'
    ? nodeToSurgeProxy(node)
    : nodeToShadowrocketProxy(node)
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
    const fields = [
      `username=${String(parsed['uuid'] ?? '')}`,
      ...surgeWebSocketFields(parsed),
    ]
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
    const fields = [
      `password=${password || String(extra['auth'] ?? '')}`,
      ...surgeTlsFields(parsed, extra),
    ]
    if (extra['downMbps']) fields.push(`download-bandwidth=${Number(extra['downMbps'])}`)
    if (extra['obfs'] === 'salamander' && extra['obfsPassword']) {
      fields.push(`salamander-password=${String(extra['obfsPassword'])}`)
    }
    return `${prefix}, ${fields.join(', ')}`
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
  if (protocol === 'vmess') {
    const tls = parsed['tls'] ? ', tls=true' : ''
    const sni = parsed['sni'] ? `, sni=${parsed['sni']}` : ''
    return `${name} = vmess, ${server}, ${port}, username=${parsed['uuid'] ?? ''}${tls}${sni}`
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
    const fields = [
      `shadowsocks=${endpoint}`,
      `method=${method}`,
      `password=${password}`,
    ]
    if (protocol === 'ssr') {
      fields.push(
        `ssr-protocol=${String(extra['protocol'] ?? 'origin')}`,
        `obfs=${String(extra['obfs'] ?? 'plain')}`,
      )
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
    const fields = [
      `${protocol === 'socks5' ? 'socks5' : 'http'}=${endpoint}`,
    ]
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

function quantumultXTransportFields(
  parsed: Row,
  extra: Row
): string[] {
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
  collectionNodeNames: Record<string, string[]>
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames)
  if (type === 'url-test') return `${name} = url-test, ${members.join(', ')}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'fallback') return `${name} = fallback, ${members.join(', ')}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'load-balance') return `${name} = load-balance, ${members.join(', ')}`
  return `${name} = select, ${members.join(', ')}`
}

function groupToQuantumultX(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames).join(',')
  if (type === 'url-test') return `url-latency-benchmark=${name}, ${members}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  if (type === 'fallback') return `fallback=${name}, ${members}, url=${group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl}, interval=${group['interval'] ?? DEFAULT_HEALTH_CHECK.interval}`
  return `static=${name}, ${members}`
}

function groupToEgern(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
): Record<string, unknown> {
  const type = String(group['type'] ?? 'select')
  const nativeType = type === 'url-test'
    ? 'auto_test'
    : type === 'load-balance'
      ? 'load_balance'
      : type
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

function ruleToIni(rule: Row, groups: Row[], client: 'surge' | 'shadowrocket'): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const target = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const noResolve = rule['no_resolve']
    && supportsRuleNoResolve(type as RuleCompatibilityType, client)
    ? ',no-resolve'
    : ''
  if (type === 'MATCH') return `FINAL,${target}`
  const resolution = resolveRuleForExport(type as RuleCompatibilityType, payload, client)
  if (resolution.level === 'unsupported') return null
  return `${resolution.type},${resolution.payload},${target}${noResolve}`
}

function ruleToQuantumultX(rule: Row, groups: Row[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const target = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  if (type === 'MATCH') return `FINAL,${target}`
  const resolution = resolveRuleForExport(
    type as RuleCompatibilityType,
    payload,
    'quantumultx',
  )
  if (resolution.level === 'unsupported') return null
  return `${resolution.type},${resolution.payload},${target}`
}

function ruleToEgern(rule: Row, groups: Row[]): Record<string, unknown> | null {
  const sourceType = String(rule['type'] ?? '')
  const sourcePayload = String(rule['payload'] ?? '')
  const policy = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const resolution = resolveRuleForExport(
    sourceType as RuleCompatibilityType,
    sourcePayload,
    'egern',
  )
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
      ...(supportsRuleNoResolve(sourceType as RuleCompatibilityType, 'egern') && rule['no_resolve']
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
    const websocket = String(parsed['network'] ?? 'tcp') === 'ws'
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
        headers: Object.keys(asRecord(parsed['wsHeaders'])).length > 0
          ? asRecord(parsed['wsHeaders'])
          : undefined,
        ...tlsFields,
      }),
    }
  }
  if (network === 'http' || network === 'h2') {
    return {
      [network === 'http' ? 'http1' : 'http2']: compactObject({
        method: extra['httpMethod'] ?? 'GET',
        path: parsed['wsPath'] ?? extra['wsPath'] ?? '/',
        headers: Object.keys(asRecord(parsed['wsHeaders'])).length > 0
          ? asRecord(parsed['wsHeaders'])
          : undefined,
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
  return ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'].includes(security)
    ? security
    : 'auto'
}

function normalizeEgernReserved(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const bytes = value.map(Number)
    return bytes.length === 3 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? bytes
      : undefined
  }
  if (typeof value === 'string') {
    const bytes = value.split(',').map(item => Number(item.trim()))
    return bytes.length === 3 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? bytes
      : undefined
  }
  return undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value)
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T
}

function resolveGroupName(groupId: string, groups: Row[]): string {
  const group = groups.find((item) => String(item['id']) === groupId)
  return group ? nativePolicyName(group) : (groupId || defaultPolicy(groups))
}

function exportPolicyGroups(groups: Row[]): Row[] {
  return groups.filter((group) => !isNativeOutletGroup(group))
}

function collectClientGroupMembers(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
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
  return String(
    groups.find((group) => String(group['name']) === '漏网之鱼')?.['name']
      ?? groups.find((group) => String(group['name']) === 'PROXY')?.['name']
      ?? groups[0]?.['name']
      ?? 'DIRECT'
  )
}

function hasEnabledMatchRule(rules: Row[]): boolean {
  return rules.some((rule) => Boolean(rule['enabled']) && String(rule['type']) === 'MATCH')
}

function sortRemoteRuleSetRows(remoteSets: Row[]): Row[] {
  return [...remoteSets].sort((a, b) =>
    Number(a['sort_order'] ?? 500) - Number(b['sort_order'] ?? 500)
    || String(a['created_at'] ?? '').localeCompare(String(b['created_at'] ?? ''))
  )
}

function safeJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function safeTag(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}
