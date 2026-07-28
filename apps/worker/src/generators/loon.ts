/**
 * Loon configuration generator
 * Generates a complete Loon .conf file
 */

import { collectGroupMembers } from './group-members'
import { resolveRemoteRuleSetRowForExport } from './remote-rule-set-resolver'
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_RULE_TARGET_GROUP_ID,
  getRuleCompatibilityLevel,
  isLoonTransportSupported,
  isRuleSetFormatCompatible,
  resolveRuleForExport,
  getRuleNoResolveHandling,
} from '@uni-conf/shared'
import type { ExportDnsPolicy } from '@uni-conf/types'
import { DEFAULT_FAKE_IP_POLICY, realIpDomains } from './dns-policy'

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
  const password = String(parsed['password'] ?? '')

  switch (protocol) {
    case 'ss': {
      const fields = [
        'Shadowsocks', server, String(port),
        String(extra['cipher'] ?? extra['method'] ?? 'aes-256-gcm'),
        quoteLoonValue(password),
      ]
      appendLoonObfs(fields, extra)
      appendBooleanField(fields, 'fast-open', extra['fastOpen'])
      appendBooleanField(fields, 'udp', extra['udp'])
      return `${name} = ${fields.join(',')}`
    }
    case 'ssr': {
      const fields = [
        'ShadowsocksR', server, String(port),
        String(extra['cipher'] ?? extra['method'] ?? 'aes-256-cfb'),
        quoteLoonValue(password),
        `protocol=${String(extra['protocol'] ?? 'origin')}`,
      ]
      if (extra['protocolParam']) fields.push(`protocol-param=${String(extra['protocolParam'])}`)
      fields.push(`obfs=${String(extra['obfs'] ?? 'plain')}`)
      if (extra['obfsParam']) fields.push(`obfs-param=${String(extra['obfsParam'])}`)
      appendBooleanField(fields, 'fast-open', extra['fastOpen'])
      appendBooleanField(fields, 'udp', extra['udp'])
      return `${name} = ${fields.join(',')}`
    }
    case 'vmess': {
      if (!isLoonTransportSupported(parsed['network'])) return null
      const fields = [
        'vmess', server, String(port),
        normalizeLoonVmessCipher(extra['cipher']),
        quoteLoonValue(String(parsed['uuid'] ?? '')),
      ]
      appendLoonTransport(fields, parsed, extra)
      fields.push(`alterId=${Number(extra['alterId'] ?? 0)}`)
      appendLoonTls(fields, parsed)
      return `${name} = ${fields.join(',')}`
    }
    case 'vless': {
      if (!isLoonTransportSupported(parsed['network'])) return null
      const fields = [
        'VLESS', server, String(port),
        quoteLoonValue(String(parsed['uuid'] ?? '')),
      ]
      appendLoonTransport(fields, parsed, extra)
      appendLoonTls(fields, parsed)
      return `${name} = ${fields.join(',')}`
    }
    case 'trojan': {
      if (!isLoonTransportSupported(parsed['network'])) return null
      const fields = ['trojan', server, String(port), quoteLoonValue(password)]
      appendLoonTransport(fields, parsed, extra)
      appendLoonTls(fields, parsed, { includeOverTls: false })
      appendLoonAlpn(fields, extra)
      appendBooleanField(fields, 'udp', extra['udp'])
      return `${name} = ${fields.join(',')}`
    }
    case 'hysteria2': {
      const fields = ['Hysteria2', server, String(port), quoteLoonValue(password || String(extra['auth'] ?? ''))]
      appendLoonTls(fields, parsed, { includeOverTls: false })
      appendBooleanField(fields, 'udp', extra['udp'])
      appendBooleanField(fields, 'fast-open', extra['fastOpen'])
      return `${name} = ${fields.join(',')}`
    }
    case 'http':
    case 'https': {
      const username = String(extra['username'] ?? '')
      const fields = [protocol, server, String(port)]
      if (username || password) fields.push(username, quoteLoonValue(password))
      if (protocol === 'https') appendLoonTls(fields, parsed, { includeOverTls: false })
      return `${name} = ${fields.join(',')}`
    }
    default:
      return null
  }
}

function appendLoonTransport(
  fields: string[],
  parsed: Record<string, unknown>,
  extra: Record<string, unknown>
): void {
  const transport = String(parsed['network'] ?? 'tcp')
  fields.push(`transport=${transport}`)
  if (transport !== 'ws' && transport !== 'http') return
  const path = String(parsed['wsPath'] ?? extra['wsPath'] ?? '/')
  fields.push(`path=${path}`)
  const headers = (parsed['wsHeaders'] ?? {}) as Record<string, unknown>
  const host = headers['Host'] ?? headers['host'] ?? parsed['sni']
  if (host) fields.push(`host=${String(host)}`)
}

function appendLoonTls(
  fields: string[],
  parsed: Record<string, unknown>,
  options: { includeOverTls?: boolean } = {}
): void {
  if (options.includeOverTls !== false) fields.push(`over-tls=${Boolean(parsed['tls'])}`)
  if (parsed['sni']) fields.push(`tls-name=${String(parsed['sni'])}`)
  if (parsed['skipCertVerify'] !== undefined) {
    fields.push(`skip-cert-verify=${Boolean(parsed['skipCertVerify'])}`)
  }
}

function appendLoonObfs(fields: string[], extra: Record<string, unknown>): void {
  const obfs = String(extra['obfs'] ?? '')
  if (obfs !== 'http' && obfs !== 'tls') return
  fields.push(`obfs-name=${obfs}`)
  const host = extra['obfsHost'] ?? extra['obfsParam']
  if (host) fields.push(`obfs-host=${String(host)}`)
  if (extra['obfsUri']) fields.push(`obfs-uri=${String(extra['obfsUri'])}`)
}

function appendLoonAlpn(fields: string[], extra: Record<string, unknown>): void {
  const values = Array.isArray(extra['alpn']) ? extra['alpn'].map(String).filter(Boolean) : []
  if (values.length === 1) fields.push(`alpn=${values[0]}`)
}

function appendBooleanField(
  fields: string[],
  key: string,
  value: unknown
): void {
  if (value !== undefined) fields.push(`${key}=${Boolean(value)}`)
}

function normalizeLoonVmessCipher(value: unknown): string {
  const cipher = String(value ?? '')
  return ['aes-128-gcm', 'chacha20-poly1305'].includes(cipher)
    ? cipher
    : 'aes-128-gcm'
}

function quoteLoonValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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
  const noResolve = rule['no_resolve']
    && getRuleNoResolveHandling(type as RuleCompatibilityType, 'loon') === 'native'
    ? ', no-resolve'
    : ''

  if (type === 'MATCH') return `FINAL, ${target}`
  const resolution = resolveRuleForExport(type as RuleCompatibilityType, payload, 'loon')
  if (resolution.level === 'unsupported') return null
  return `${resolution.type}, ${resolution.payload}, ${target}${noResolve}`
}

export function generateLoon(
  nodes: Record<string, unknown>[],
  groups: Record<string, unknown>[],
  rules: Record<string, unknown>[],
  remoteSets: Record<string, unknown>[],
  collectionNodeNames: Record<string, string[]> = {},
  options: { dnsPolicy?: ExportDnsPolicy; ruleSetConversionBaseUrl?: string } = {}
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY
  const lines: string[] = []
  const sortedRemoteSets = sortRemoteRuleSetRows(remoteSets)

  // [General]
  lines.push('[General]')
  lines.push('ip-mode = v4-only')
  lines.push('dns-server = system, 119.29.29.29, 223.5.5.5')
  if (dnsPolicy.resolution.mode === 'split') {
    lines.push('doh-server = https://1.1.1.1/dns-query, https://8.8.8.8/dns-query')
  }
  lines.push(`real-ip = ${realIpDomains(dnsPolicy).join(', ')}`)
  lines.push('allow-wifi-access = false')
  lines.push('wifi-access-http-port = 7222')
  lines.push('wifi-access-socks5-port = 7221')
  lines.push('interface-mode = auto')
  lines.push('test-timeout = 5')
  lines.push('disconnect-on-policy-change = false')
  lines.push(`proxy-test-url = ${DEFAULT_HEALTH_CHECK.testUrl}`)
  lines.push('internet-test-url = http://connectivitycheck.gstatic.com/generate_204')
  lines.push('')

  if (dnsPolicy.resolution.mode === 'split') {
    lines.push('[Host]')
    lines.push('*.cn = server:223.5.5.5')
    lines.push('* = server:https://1.1.1.1/dns-query')
    lines.push('')
  }

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
  const hasFinal = rules.some(r => Boolean(r['enabled']) && String(r['type']) === 'MATCH')
  if (!hasFinal) {
    lines.push(`FINAL, ${defaultPolicy(groups)}`)
  }
  lines.push('')

  // [Remote Rule]
  lines.push('[Remote Rule]')
  for (const rs of sortedRemoteSets) {
    if (!rs['enabled']) continue
    const resolved = resolveRemoteRuleSetRowForExport(rs, 'loon', options.ruleSetConversionBaseUrl)
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
  const group = groups.find(item => String(item['id']) === DEFAULT_RULE_TARGET_GROUP_ID)
  return group ? nativePolicyName(group) : 'DIRECT'
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
