/**
 * Loon configuration generator
 * Generates a complete Loon .conf file
 */

import { collectGroupMembers } from './group-members'
import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'
import { DEFAULT_HEALTH_CHECK, getRuleCompatibilityLevel, isRuleSetFormatCompatible } from '@uni-conf/shared'

type RuleCompatibilityType = Parameters<typeof getRuleCompatibilityLevel>[0]

function safeJson(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string') return {}
  try { return JSON.parse(text) as Record<string, unknown> } catch { return {} }
}

function nodeToLoonProxy(node: Record<string, unknown>): string | null {
  const name = String(node['name'] ?? '')
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'])
  const extra = (parsed['extra'] ?? {}) as Record<string, unknown>

  switch (protocol) {
    case 'ss': {
      const cipher = String(extra['cipher'] ?? 'aes-256-gcm')
      const password = String(parsed['password'] ?? '')
      const tls = parsed['tls'] ? `, over-tls=true` : ''
      return `${name} = Shadowsocks, ${server}, ${port}, encrypt-method=${cipher}, password=${password}${tls}`
    }
    case 'vmess': {
      const uuid = String(parsed['uuid'] ?? '')
      const network = String(parsed['network'] ?? 'tcp')
      const tls = parsed['tls'] ? `, tls=true` : ''
      const sni = parsed['sni'] ? `, tls-name=${parsed['sni']}` : ''
      let transport = ''
      if (network === 'ws') {
        const wsPath = String(extra['wsPath'] ?? '/')
        transport = `, transport=ws, path=${wsPath}`
      }
      return `${name} = vmess, ${server}, ${port}, username=${uuid}${transport}${tls}${sni}`
    }
    case 'trojan': {
      const password = String(parsed['password'] ?? '')
      const sni = parsed['sni'] ? `, tls-name=${parsed['sni']}` : ''
      const skipVerify = parsed['skipCertVerify'] ? `, skip-cert-verify=true` : ''
      return `${name} = trojan, ${server}, ${port}, password=${password}${sni}${skipVerify}`
    }
    case 'anytls': {
      const password = String(parsed['password'] ?? '')
      const sni = parsed['sni'] ? `, tls-name=${parsed['sni']}` : ''
      const fingerprint = extra['client-fingerprint'] ?? extra['clientFingerprint'] ?? extra['fingerprint'] ?? extra['fp']
      const fp = fingerprint ? `, client-fingerprint=${fingerprint}` : ''
      const udp = extra['udp'] !== undefined ? `, udp-relay=${Boolean(extra['udp'])}` : ''
      const alpn = Array.isArray(extra['alpn']) ? `, alpn=${extra['alpn'].map(String).join('|')}` : ''
      const skipVerify = parsed['skipCertVerify'] ? `, skip-cert-verify=true` : ''
      return `${name} = anytls, ${server}, ${port}, password=${password}${sni}${fp}${udp}${alpn}${skipVerify}`
    }
    case 'http':
    case 'https': {
      const username = String(extra['username'] ?? '')
      const password = String(parsed['password'] ?? '')
      const overTls = protocol === 'https' ? `, over-tls=true` : ''
      const creds = username ? `, username=${username}, password=${password}` : ''
      return `${name} = http, ${server}, ${port}${creds}${overTls}`
    }
    case 'socks5': {
      const username = String(extra['username'] ?? '')
      const password = String(parsed['password'] ?? '')
      const creds = username ? `, username=${username}, password=${password}` : ''
      return `${name} = socks5, ${server}, ${port}${creds}`
    }
    default:
      return null
  }
}

function groupToLoon(
  group: Record<string, unknown>,
  allGroups: Record<string, unknown>[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]>
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const members = collectGroupMembers(group, allGroups, nodeNames, collectionNodeNames, nativePolicyName).join(', ')

  if (type === 'select') return `${name} = select, ${members}`
  if (type === 'url-test') {
    const testUrl = String(group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl)
    const interval = Number(group['interval'] ?? DEFAULT_HEALTH_CHECK.interval)
    return `${name} = url-latency-benchmark, ${members}, url=${testUrl}, interval=${interval}`
  }
  if (type === 'fallback') {
    const testUrl = String(group['test_url'] ?? DEFAULT_HEALTH_CHECK.testUrl)
    const interval = Number(group['interval'] ?? DEFAULT_HEALTH_CHECK.interval)
    return `${name} = fallback, ${members}, url=${testUrl}, interval=${interval}`
  }
  if (type === 'load-balance') return `${name} = load-balance, ${members}`
  return `${name} = select, ${members}`
}

function ruleToLoon(rule: Record<string, unknown>, allGroups: Record<string, unknown>[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const targetGroupId = String(rule['target_group_id'] ?? '')
  const targetGroup = allGroups.find(g => String(g['id']) === targetGroupId)
  const target = targetGroup ? nativePolicyName(targetGroup) : 'PROXY'
  const noResolve = rule['no_resolve'] ? ', no-resolve' : ''

  // Map rule types to Loon format
  const typeMap: Record<string, string> = {
    'DOMAIN': 'DOMAIN',
    'DOMAIN-SUFFIX': 'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD': 'DOMAIN-KEYWORD',
    'IP-CIDR': 'IP-CIDR',
    'IP-CIDR6': 'IP-CIDR6',
    'GEOIP': 'GEOIP',
    'GEOSITE': 'GEOSITE',
    'MATCH': 'FINAL',
  }

  const loonType = typeMap[type] ?? type
  if (type === 'MATCH') return `FINAL, ${target}`
  if (getRuleCompatibilityLevel(type as RuleCompatibilityType, 'loon') === 'unsupported') return null
  return `${loonType}, ${payload}, ${target}${noResolve}`
}

export function generateLoon(
  nodes: Record<string, unknown>[],
  groups: Record<string, unknown>[],
  rules: Record<string, unknown>[],
  remoteSets: Record<string, unknown>[],
  collectionNodeNames: Record<string, string[]> = {}
): string {
  const lines: string[] = []
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)

  // [General]
  lines.push('[General]')
  lines.push('ip-mode = v4-only')
  lines.push('dns-server = system, 119.29.29.29, 223.5.5.5, 8.8.8.8')
  lines.push('allow-wifi-access = false')
  lines.push('wifi-access-http-port = 7222')
  lines.push('wifi-access-socks5-port = 7221')
  lines.push('interface-mode = auto')
  lines.push('test-timeout = 5')
  lines.push('disconnect-on-policy-change = false')
  lines.push(`proxy-test-url = ${DEFAULT_HEALTH_CHECK.testUrl}`)
  lines.push('internet-test-url = http://connectivitycheck.gstatic.com/generate_204')
  lines.push('')

  // [Proxy]
  lines.push('[Proxy]')
  const validNodes: string[] = []
  for (const node of nodes) {
    const line = nodeToLoonProxy(node)
    if (line) { lines.push(line); validNodes.push(String(node['name'] ?? '')) }
  }
  lines.push('')

  // [Remote Proxy] (subscription URLs — Loon can reference remote proxy lists)
  lines.push('[Remote Proxy]')
  lines.push('')

  // [Proxy Group]
  lines.push('[Proxy Group]')
  for (const group of groups.filter(group => !isNativeOutletGroup(group))) {
    const line = groupToLoon(group, groups, validNodes, collectionNodeNames)
    lines.push(line)
  }
  lines.push('')

  // [Rule]
  lines.push('[Rule]')
  for (const rule of rules) {
    if (!rule['enabled']) continue
    const line = ruleToLoon(rule, groups)
    if (line) lines.push(line)
  }
  // Ensure FINAL rule exists
  const hasFinal = rules.some(r => String(r['type']) === 'MATCH')
  if (!hasFinal) {
    lines.push(`FINAL, ${defaultPolicy(groups)}`)
  }
  lines.push('')

  // [Remote Rule]
  lines.push('[Remote Rule]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'loon')
    if (!resolved || !isRuleSetFormatCompatible('loon', resolved.format)) continue
    const name = String(rs['name'] ?? '')
    const targetGroupId = String(rs['target_group_id'] ?? '')
    const targetGroup = groups.find(g => String(g['id']) === targetGroupId)
    const target = targetGroup ? nativePolicyName(targetGroup) : 'PROXY'
    lines.push(`${resolved.url}, policy=${target}, tag=${name}, enabled=true`)
  }
  lines.push('')

  // [URL Rewrite]
  lines.push('[URL Rewrite]')
  lines.push('')

  // [MITM]
  lines.push('[MITM]')
  lines.push('enable = false')
  lines.push('')

  return lines.join('\n')
}

function defaultPolicy(groups: Array<Record<string, unknown>>): string {
  return String(
    groups.find(group => String(group['name']) === '漏网之鱼')?.['name']
      ?? groups.find(group => String(group['name']) === 'PROXY')?.['name']
      ?? groups[0]?.['name']
      ?? 'PROXY'
  )
}

function nativePolicyName(group: Record<string, unknown>): string {
  const type = String(group['type'] ?? '')
  if (type === 'direct') return 'DIRECT'
  if (type === 'reject') return 'REJECT'
  return String(group['name'] ?? '')
}

function isNativeOutletGroup(group: Record<string, unknown>): boolean {
  return ['direct', 'reject'].includes(String(group['type'] ?? ''))
}

function sortRemoteRuleSetRows(remoteSets: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...remoteSets].sort((a, b) =>
    Number(a['sort_order'] ?? 500) - Number(b['sort_order'] ?? 500)
    || String(a['created_at'] ?? '').localeCompare(String(b['created_at'] ?? ''))
  )
}
