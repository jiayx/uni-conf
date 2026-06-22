import yaml from 'js-yaml'
import { generateMihomoYaml } from './mihomo'
import { collectGroupMembers } from './group-members'
import { nodeToSubscriptionUri } from './node-subscription'
import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'
import type { DnsMode, ProxyGroup, ProxyNode, ProxyRule, RemoteRuleSet } from '@uni-conf/types'

type Row = Record<string, unknown>

export function generateStashYaml(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  collectionNodeNames: Record<string, string[]> = {},
  options: { dnsMode?: DnsMode } = {}
): string {
  return generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, options)
}

export function generateSurge(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {}
): string {
  const lines = buildIniConfig({
    client: 'surge',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
    general: [
      '[General]',
      'loglevel = notify',
      'internet-test-url = http://connectivitycheck.gstatic.com/generate_204',
      'proxy-test-url = http://www.gstatic.com/generate_204',
      'test-timeout = 5',
      '',
    ],
    remoteSection: '[Rule Set]',
  })
  return lines.join('\n')
}

export function generateShadowrocket(
  nodes: Row[],
  groups: Row[],
  rules: Row[],
  remoteSets: Row[],
  collectionNodeNames: Record<string, string[]> = {}
): string {
  const lines = buildIniConfig({
    client: 'shadowrocket',
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
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
  collectionNodeNames: Record<string, string[]> = {}
): string {
  const serializedNodes = nodes
    .map((node) => ({ node, uri: nodeToSubscriptionUri(node) }))
    .filter((item): item is { node: Row; uri: string } => item.uri !== null)
  const nodeUris = serializedNodes.map((item) => item.uri)
  const nodeNames = serializedNodes.map((item) => String(item.node['name'] ?? '')).filter(Boolean)
  const lines: string[] = [
    '[general]',
    'server_check_url=http://www.gstatic.com/generate_204',
    'network_check_url=http://connectivitycheck.gstatic.com/generate_204',
    '',
    '[server_local]',
    ...nodeUris,
    '',
    '[policy]',
  ]

  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToQuantumultX(group, groups, nodeNames, collectionNodeNames))
  }

  lines.push('', '[filter_remote]')
  for (const rs of remoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'quantumultx')
    if (!resolved || !isCompatibleRemoteSet('quantumultx', resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`${resolved.url}, tag=${rs['name']}, force-policy=${target}, enabled=true`)
  }

  lines.push('', '[filter_local]')
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToQuantumultX(rule, groups)
    if (line) lines.push(line)
  }
  if (!rules.some((rule) => String(rule['type']) === 'MATCH')) {
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
  collectionNodeNames: Record<string, string[]> = {}
): string {
  const proxies = nodes
    .map(nodeToEgernProxy)
    .filter((proxy): proxy is Record<string, unknown> => proxy !== null)
  const nodeNames = proxies.map((proxy) => String(proxy['name'] ?? '')).filter(Boolean)
  const ruleSets = remoteSets
    .filter((rs) => rs['enabled'])
    .map((rs) => ({ source: rs, resolved: resolveRemoteRuleSetRowForExport(rs, 'egern') }))
    .filter((item): item is { source: Row; resolved: { url: string; format: string } } =>
      Boolean(item.resolved) && isCompatibleRemoteSet('egern', item.resolved!.format)
    )
    .map(({ source: rs, resolved }) => ({
      tag: safeTag(String(rs['name'] ?? 'remote')),
      type: 'remote',
      url: resolved.url,
      format: resolved.format === 'egern' ? 'yaml' : 'source',
      update_interval: Number(rs['update_interval'] ?? 24) * 3600,
    }))

  const config = {
    auto_update: { interval: 86400 },
    ipv6: false,
    http_port: 3080,
    socks_port: 3081,
    proxies,
    policy_groups: exportPolicyGroups(groups)
      .map((group) => groupToEgern(group, groups, nodeNames, collectionNodeNames)),
    rule_sets: ruleSets,
    rules: [
      ...remoteSets
        .filter((rs) => {
          if (!rs['enabled']) return false
          const resolved = resolveRemoteRuleSetRowForExport(rs, 'egern')
          return Boolean(resolved && isCompatibleRemoteSet('egern', resolved.format))
        })
        .map((rs) => ({
          rule_set: safeTag(String(rs['name'] ?? 'remote')),
          policy: resolveGroupName(String(rs['target_group_id'] ?? ''), groups),
        })),
      ...rules
        .filter((rule) => rule['enabled'])
        .map((rule) => ruleToEgern(rule, groups))
        .filter(Boolean),
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
  general,
  remoteSection,
}: {
  client: 'surge' | 'shadowrocket'
  nodes: Row[]
  groups: Row[]
  rules: Row[]
  remoteSets: Row[]
  collectionNodeNames: Record<string, string[]>
  general: string[]
  remoteSection: string
}): string[] {
  const validNodes: string[] = []
  const lines: string[] = [...general, '[Proxy]']
  for (const node of nodes) {
    const line = nodeToIniProxy(node)
    if (line) {
      lines.push(line)
      validNodes.push(String(node['name'] ?? ''))
    }
  }

  lines.push('', '[Proxy Group]')
  for (const group of exportPolicyGroups(groups)) {
    lines.push(groupToIni(group, groups, validNodes, collectionNodeNames))
  }

  lines.push('', remoteSection)
  for (const rs of remoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, client)
    if (!resolved || !isCompatibleRemoteSet(client, resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`${safeTag(String(rs['name'] ?? 'remote'))} = ${resolved.url}, policy=${target}, update-interval=${Number(rs['update_interval'] ?? 24) * 3600}`)
  }

  lines.push('', '[Rule]')
  for (const rs of remoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, client)
    if (!resolved || !isCompatibleRemoteSet(client, resolved.format)) continue
    const target = resolveGroupName(String(rs['target_group_id'] ?? ''), groups)
    lines.push(`RULE-SET,${safeTag(String(rs['name'] ?? 'remote'))},${target}`)
  }
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToIni(rule, groups)
    if (line) lines.push(line)
  }
  if (!rules.some((rule) => String(rule['type']) === 'MATCH')) {
    lines.push(`FINAL,${defaultPolicy(groups)}`)
  }
  lines.push('')

  return lines
}

function nodeToIniProxy(node: Row): string | null {
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
    const fingerprint = extra['client-fingerprint'] ?? extra['clientFingerprint']
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

function groupToIni(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames)
  if (type === 'url-test') return `${name} = url-test, ${members.join(', ')}, url=${group['test_url'] ?? 'http://www.gstatic.com/generate_204'}, interval=${group['interval'] ?? 300}`
  if (type === 'fallback') return `${name} = fallback, ${members.join(', ')}, url=${group['test_url'] ?? 'http://www.gstatic.com/generate_204'}, interval=${group['interval'] ?? 300}`
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
  if (type === 'url-test') return `url-latency-benchmark=${name}, ${members}, url=${group['test_url'] ?? 'http://www.gstatic.com/generate_204'}, interval=${group['interval'] ?? 300}`
  if (type === 'fallback') return `fallback=${name}, ${members}, url=${group['test_url'] ?? 'http://www.gstatic.com/generate_204'}, interval=${group['interval'] ?? 300}`
  return `static=${name}, ${members}`
}

function groupToEgern(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
): Record<string, unknown> {
  const type = String(group['type'] ?? 'select')
  return {
    name: String(group['name'] ?? ''),
    type: type === 'url-test' ? 'url_test' : type === 'load-balance' ? 'load_balance' : type,
    policies: collectClientGroupMembers(group, groups, nodeNames, collectionNodeNames),
    url: group['test_url'] ?? 'http://www.gstatic.com/generate_204',
    interval: Number(group['interval'] ?? 300),
  }
}

function ruleToIni(rule: Row, groups: Row[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const target = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const noResolve = rule['no_resolve'] ? ',no-resolve' : ''
  if (type === 'MATCH') return `FINAL,${target}`
  if (['SCRIPT', 'IN-TYPE'].includes(type)) return null
  return `${type},${payload},${target}${noResolve}`
}

function ruleToQuantumultX(rule: Row, groups: Row[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const target = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const map: Record<string, string> = {
    DOMAIN: 'HOST',
    'DOMAIN-SUFFIX': 'HOST-SUFFIX',
    'DOMAIN-KEYWORD': 'HOST-KEYWORD',
    'IP-CIDR': 'IP-CIDR',
    'IP-CIDR6': 'IP6-CIDR',
    GEOIP: 'GEOIP',
    MATCH: 'FINAL',
  }
  if (!map[type]) return null
  if (type === 'MATCH') return `FINAL,${target}`
  return `${map[type]},${payload},${target}`
}

function ruleToEgern(rule: Row, groups: Row[]): Record<string, unknown> | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const policy = resolveGroupName(String(rule['target_group_id'] ?? ''), groups)
  const map: Record<string, string> = {
    DOMAIN: 'domain',
    'DOMAIN-SUFFIX': 'domain_suffix',
    'DOMAIN-KEYWORD': 'domain_keyword',
    'DOMAIN-REGEX': 'domain_regex',
    'IP-CIDR': 'ip_cidr',
    'IP-CIDR6': 'ip_cidr',
    GEOIP: 'geoip',
    GEOSITE: 'geosite',
    MATCH: 'default',
  }
  const key = map[type]
  if (!key) return null
  if (type === 'MATCH') return { default: policy }
  return { [key]: payload, policy }
}

function nodeToEgernProxy(node: Row): Record<string, unknown> | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = asRecord(parsed['extra'])
  if (!name || !server || !port) return null
  if (protocol === 'ss') {
    return { name, type: 'ss', server, port, cipher: extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm', password: parsed['password'] ?? '' }
  }
  if (protocol === 'vmess') {
    return { name, type: 'vmess', server, port, uuid: parsed['uuid'] ?? '', tls: Boolean(parsed['tls']), sni: parsed['sni'] }
  }
  if (protocol === 'trojan') {
    return { name, type: 'trojan', server, port, password: parsed['password'] ?? '', sni: parsed['sni'] }
  }
  if (protocol === 'anytls') {
    const fingerprint = extra['client-fingerprint'] ?? extra['clientFingerprint']
    return {
      name,
      type: 'anytls',
      server,
      port,
      password: parsed['password'] ?? '',
      sni: parsed['sni'],
      'client-fingerprint': fingerprint,
      alpn: Array.isArray(extra['alpn']) ? extra['alpn'].map(String) : undefined,
      udp: extra['udp'],
    }
  }
  if (protocol === 'http' || protocol === 'https') {
    return { name, type: 'http', server, port, tls: protocol === 'https' || Boolean(parsed['tls']) }
  }
  if (protocol === 'socks5') {
    return { name, type: 'socks5', server, port }
  }
  return null
}

function isCompatibleRemoteSet(client: string, format: string): boolean {
  const matrix: Record<string, string[]> = {
    surge: ['surge', 'text'],
    shadowrocket: ['shadowrocket', 'surge', 'text'],
    quantumultx: ['quantumultx', 'text'],
    egern: ['egern', 'text'],
  }
  return matrix[client]?.includes(format) ?? false
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
