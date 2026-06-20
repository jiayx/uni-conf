/**
 * Loon configuration generator
 * Generates a complete Loon .conf file
 */

import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'

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
      const fingerprint = extra['client-fingerprint'] ?? extra['clientFingerprint']
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
  nodeNames: string[]
): string {
  const name = String(group['name'] ?? '')
  const type = String(group['type'] ?? 'select')
  const groupIds = (safeJson(group['group_ids'] as string) as unknown as string[]) ?? []
  const builtins = (safeJson(group['builtins'] as string) as unknown as string[]) ?? []

  // Collect referenced group names
  const nestedGroupNames = groupIds.map((gid: string) => {
    const g = allGroups.find(g => String(g['id']) === gid)
    return g ? String(g['name']) : null
  }).filter(Boolean) as string[]

  const members = [...nodeNames, ...nestedGroupNames, ...builtins].join(', ')

  if (type === 'select') return `${name} = select, ${members}`
  if (type === 'url-test') {
    const testUrl = String(group['test_url'] ?? 'http://www.google.com/generate_204')
    const interval = Number(group['interval'] ?? 300)
    return `${name} = url-latency-benchmark, ${members}, url=${testUrl}, interval=${interval}`
  }
  if (type === 'fallback') {
    const testUrl = String(group['test_url'] ?? 'http://www.google.com/generate_204')
    const interval = Number(group['interval'] ?? 300)
    return `${name} = fallback, ${members}, url=${testUrl}, interval=${interval}`
  }
  if (type === 'load-balance') return `${name} = load-balance, ${members}`
  if (type === 'direct') return `${name} = select, DIRECT`
  if (type === 'reject') return `${name} = select, REJECT`
  return `${name} = select, ${members}`
}

function ruleToLoon(rule: Record<string, unknown>, allGroups: Record<string, unknown>[]): string | null {
  const type = String(rule['type'] ?? '')
  const payload = String(rule['payload'] ?? '')
  const targetGroupId = String(rule['target_group_id'] ?? '')
  const targetGroup = allGroups.find(g => String(g['id']) === targetGroupId)
  const target = targetGroup ? String(targetGroup['name']) : 'PROXY'
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

  // Loon doesn't support some rule types
  if (type === 'PROCESS-NAME' || type === 'PROCESS-PATH' || type === 'IN-TYPE') return null

  const loonType = typeMap[type] ?? type
  if (type === 'MATCH') return `FINAL, ${target}`
  return `${loonType}, ${payload}, ${target}${noResolve}`
}

export function generateLoon(
  nodes: Record<string, unknown>[],
  groups: Record<string, unknown>[],
  rules: Record<string, unknown>[],
  remoteSets: Record<string, unknown>[]
): string {
  const lines: string[] = []

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
  lines.push('proxy-test-url = http://www.google.com/generate_204')
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
  for (const group of groups) {
    const line = groupToLoon(group, groups, validNodes)
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
    const proxyGroup = groups.find(g => String(g['name']) === 'PROXY')
    lines.push(`FINAL, ${proxyGroup ? 'PROXY' : groups[0] ? String(groups[0]['name']) : 'PROXY'}`)
  }
  lines.push('')

  // [Remote Rule]
  lines.push('[Remote Rule]')
  for (const rs of remoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'loon')
    if (!resolved || !isLoonCompatibleRemoteSet(resolved.format)) continue
    const name = String(rs['name'] ?? '')
    const targetGroupId = String(rs['target_group_id'] ?? '')
    const targetGroup = groups.find(g => String(g['id']) === targetGroupId)
    const target = targetGroup ? String(targetGroup['name']) : 'PROXY'
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

function isLoonCompatibleRemoteSet(format: string): boolean {
  return ['loon', 'surge', 'shadowrocket', 'text'].includes(format)
}
