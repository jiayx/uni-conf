import { load as parseYaml } from 'js-yaml'
import type {
  RemoteRuleSet,
  RemoteRuleSetInspectionMode,
  RemoteRuleSetValidationIssue,
  RemoteRuleSetValidationResult,
  RuleSetBehavior,
} from '@uni-conf/types'
import { parseSafeRemoteHttpUrl, safeRemoteFetch, SafeRemoteUrlError } from './safe-remote-fetch'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_ISSUES = 5

interface ValidationOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  checkedAt?: string
}

interface ParsedRules {
  inspectionMode: RemoteRuleSetInspectionMode
  rules?: unknown[]
  issue?: RemoteRuleSetValidationIssue
}

interface EgernRuleValue {
  __uniConfEgernKey: string
  value: unknown
}

const EGERN_RULE_SET_KEYS = new Set([
  'domain_set', 'domain_suffix_set', 'domain_keyword_set', 'domain_regex_set', 'domain_wildcard_set',
  'geoip_set', 'ip_cidr_set', 'ip_cidr6_set', 'url_regex_set', 'asn_set', 'user_agent_set',
  'ssid_set', 'bssid_set', 'cellular_set', 'protocol_set', 'dest_port_set',
])

export async function validateRemoteRuleSetContent(
  ruleSet: Pick<RemoteRuleSet, 'url' | 'format' | 'behavior'>,
  options: ValidationOptions = {}
): Promise<RemoteRuleSetValidationResult> {
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  const base = {
    checkedAt,
    url: ruleSet.url,
    format: ruleSet.format,
    behavior: ruleSet.behavior,
    inspectionMode: 'text' as const,
    byteLength: 0,
    invalidRuleCount: 0,
    issues: [] as RemoteRuleSetValidationIssue[],
  }

  try {
    parseSafeRemoteHttpUrl(ruleSet.url)
  } catch {
    return invalidResult(base, issue('unsafe_url', '规则集地址必须是公开可访问的 HTTP(S) 地址', 'The rule set URL must be a publicly routable HTTP(S) address.'))
  }

  let response: Response
  try {
    response = await fetchRuleSet(
      options.fetcher ?? fetch,
      ruleSet.url,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch (error) {
    if (error instanceof SafeRemoteUrlError) {
      return invalidResult(base, issue('unsafe_url', '规则集重定向到了不安全的地址', 'The rule set redirected to an unsafe address.'))
    }
    return invalidResult(base, issue('download_failed', '规则集下载失败或超时', 'The rule set download failed or timed out.'))
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || undefined
  if (!response.ok) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'http_error',
      `规则集服务器返回 HTTP ${response.status}`,
      `The rule set server returned HTTP ${response.status}.`
    ))
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (declaredLength > maxBytes) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'content_too_large',
      `规则集超过 ${formatBytes(maxBytes)} 大小限制`,
      `The rule set exceeds the ${formatBytes(maxBytes)} size limit.`
    ))
  }

  const body = await readLimitedBody(response, maxBytes)
  if (!body) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'content_too_large',
      `规则集超过 ${formatBytes(maxBytes)} 大小限制`,
      `The rule set exceeds the ${formatBytes(maxBytes)} size limit.`
    ))
  }

  const withResponse = { ...base, httpStatus: response.status, contentType, byteLength: body.byteLength }
  if (body.byteLength === 0) {
    return invalidResult(withResponse, issue('empty_content', '规则集内容为空', 'The rule set is empty.'))
  }

  if (isSingBoxBinary(ruleSet.format, body)) {
    const binaryIssue = issue(
      'binary_header_only',
      '已识别 sing-box SRS 二进制规则集；已验证容器头，但无法逐条检查规则内容',
      'Recognized a sing-box SRS binary rule set. The container header is valid, but individual rules cannot be inspected.',
      'warning'
    )
    return {
      ...withResponse,
      status: 'warning',
      inspectionMode: 'binary-header',
      invalidRuleCount: 0,
      issues: [binaryIssue],
    }
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body)
  } catch {
    return invalidResult(withResponse, issue('invalid_encoding', '规则集不是有效的 UTF-8 文本', 'The rule set is not valid UTF-8 text.'))
  }

  if (looksLikeHtml(text, contentType)) {
    return invalidResult(withResponse, issue('html_response', '规则集地址返回了 HTML 页面，而不是规则内容', 'The rule set URL returned an HTML page instead of rule content.'))
  }

  const parsed = parseRules(text, ruleSet.format)
  if (parsed.issue) {
    return invalidResult({ ...withResponse, inspectionMode: parsed.inspectionMode }, parsed.issue)
  }

  const rules = parsed.rules ?? []
  if (rules.length === 0) {
    return invalidResult({ ...withResponse, inspectionMode: parsed.inspectionMode }, issue('no_rules', '没有找到可用规则', 'No usable rules were found.'))
  }

  const invalid = validateRules(rules, ruleSet.behavior)
  const issues = invalid.slice(0, MAX_ISSUES)
  return {
    ...withResponse,
    status: invalid.length > 0 ? 'warning' : 'valid',
    inspectionMode: parsed.inspectionMode,
    ruleCount: rules.length,
    invalidRuleCount: invalid.length,
    issues,
  }
}

function parseRules(text: string, format: RemoteRuleSet['format']): ParsedRules {
  const trimmed = text.trim()
  if (format === 'egern') {
    try {
      const rules = extractEgernRules(parseYaml(trimmed))
      return rules
        ? { inspectionMode: 'structured', rules }
        : { inspectionMode: 'structured', issue: issue('invalid_structure', 'Egern YAML 中缺少受支持的规则集数组', 'The Egern YAML document does not contain supported rule-set arrays.') }
    } catch {
      return { inspectionMode: 'structured', issue: issue('invalid_yaml', 'Egern 规则集不是有效的 YAML', 'The Egern rule set is not valid YAML.') }
    }
  }
  if (format === 'singbox' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed) as unknown
      const rules = extractStructuredRules(json)
      return rules
        ? { inspectionMode: 'structured', rules }
        : { inspectionMode: 'structured', issue: issue('invalid_structure', 'JSON 中缺少 rules 数组', 'The JSON document does not contain a rules array.') }
    } catch {
      if (format === 'singbox') {
        return { inspectionMode: 'structured', issue: issue('invalid_json', 'sing-box 规则集不是有效的 JSON 或 SRS 文件', 'The sing-box rule set is neither valid JSON nor an SRS file.') }
      }
    }
  }

  if (/^(payload|rules|domain_set|ip_cidr|ip_cidr_set)\s*:/m.test(trimmed)) {
    try {
      const rules = extractStructuredRules(parseYaml(trimmed))
      return rules
        ? { inspectionMode: 'structured', rules }
        : { inspectionMode: 'structured', issue: issue('invalid_structure', 'YAML 中缺少规则数组', 'The YAML document does not contain a rule array.') }
    } catch {
      return { inspectionMode: 'structured', issue: issue('invalid_yaml', '规则集不是有效的 YAML', 'The rule set is not valid YAML.') }
    }
  }

  return { inspectionMode: 'text', rules: extractTextRules(text) }
}

function extractEgernRules(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const presentKeys = [...EGERN_RULE_SET_KEYS].filter(key => key in record)
  if (presentKeys.length === 0) return null
  return presentKeys.flatMap((key): EgernRuleValue[] => {
    const values = record[key]
    if (!Array.isArray(values)) return [{ __uniConfEgernKey: key, value: values }]
    return values.map(item => ({ __uniConfEgernKey: key, value: item }))
  })
}

function extractStructuredRules(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['payload', 'rules', 'domain_set', 'ip_cidr']) {
    if (Array.isArray(record[key])) return record[key]
  }
  return null
}

function extractTextRules(text: string): string[] {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.startsWith('#') && !line.startsWith('//') && !line.startsWith(';'))
}

function validateRules(rules: unknown[], behavior: RuleSetBehavior): RemoteRuleSetValidationIssue[] {
  const issues: RemoteRuleSetValidationIssue[] = []
  for (const [index, value] of rules.entries()) {
    const valid = value && typeof value === 'object' && !Array.isArray(value)
      ? isValidStructuredRule(value as Record<string, unknown>, behavior)
      : typeof value === 'string' && isValidRule(value.trim(), behavior)
    if (!valid) {
      issues.push(issue(
        'invalid_rule',
        `第 ${index + 1} 条规则与 ${behavior} 内容类型不匹配`,
        `Rule ${index + 1} does not match the ${behavior} behavior.`,
        'warning',
        index + 1
      ))
    }
  }
  return issues
}

function isValidStructuredRule(value: Record<string, unknown>, behavior: RuleSetBehavior): boolean {
  if (isEgernRuleValue(value)) return isValidEgernRuleValue(value, behavior)
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  if (behavior === 'classical') return true
  const expectedKeys = behavior === 'domain'
    ? ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'geosite']
    : ['ip_cidr', 'ip_is_private', 'geoip', 'source_ip_cidr']
  return expectedKeys.some(key => key in value)
}

function isEgernRuleValue(value: Record<string, unknown>): value is EgernRuleValue & Record<string, unknown> {
  return typeof value['__uniConfEgernKey'] === 'string' && 'value' in value
}

function isValidEgernRuleValue(rule: EgernRuleValue, behavior: RuleSetBehavior): boolean {
  const key = rule.__uniConfEgernKey
  if (!EGERN_RULE_SET_KEYS.has(key)) return false
  if (behavior === 'domain' && !key.startsWith('domain_')) return false
  if (behavior === 'ipcidr' && key !== 'ip_cidr_set' && key !== 'ip_cidr6_set') return false
  const value = rule.value

  if (key === 'ip_cidr_set' || key === 'ip_cidr6_set') {
    return typeof value === 'string' && isIpCidr(value)
  }
  if (key === 'domain_set' || key === 'domain_suffix_set') {
    return typeof value === 'string' && isValidRule(value, 'domain')
  }
  if (key === 'domain_regex_set' || key === 'url_regex_set') {
    if (typeof value !== 'string' || !value) return false
    try { new RegExp(value); return true } catch { return false }
  }
  if (key === 'dest_port_set') {
    return (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535)
      || (typeof value === 'string' && isValidPortSelector(value))
  }
  if (key === 'protocol_set') {
    return typeof value === 'string' && ['tcp', 'udp', 'http', 'https', 'quic', 'stun'].includes(value.toLowerCase())
  }
  return typeof value === 'string' && Boolean(value.trim())
}

function isValidPortSelector(value: string): boolean {
  const match = value.match(/^(\d{1,5})(?:[-:](\d{1,5}))?$/)
  if (!match) return false
  const start = Number(match[1])
  const end = Number(match[2] ?? match[1])
  return start >= 1 && start <= 65535 && end >= start && end <= 65535
}

function isValidRule(value: string, behavior: RuleSetBehavior): boolean {
  if (!value) return false
  if (behavior === 'classical') return /^[A-Z][A-Z0-9-]*\s*,\s*.+/.test(value)
  if (behavior === 'ipcidr') return isIpCidr(value)
  const normalized = value.replace(/^(?:\+\.|\*\.|\.)/, '')
  return normalized === 'localhost' || /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9_][a-z0-9_-]*$/i.test(normalized)
}

function isIpCidr(value: string): boolean {
  const [address, prefixText, extra] = value.split('/')
  if (extra !== undefined || !address || prefixText === undefined || !/^\d+$/.test(prefixText)) return false
  const prefix = Number(prefixText)
  if (address.includes(':')) return isValidIpv6(address) && prefix >= 0 && prefix <= 128
  const octets = address.split('.')
  return prefix >= 0 && prefix <= 32 && octets.length === 4 && octets.every(part => /^\d+$/.test(part) && Number(part) <= 255)
}

function isValidIpv6(address: string): boolean {
  try {
    const parsed = new URL(`http://[${address}]/`)
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
  } catch {
    return false
  }
}

async function fetchRuleSet(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  return safeRemoteFetch(fetcher, url, {
    method: 'GET',
    headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' },
  }, { timeoutMs })
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function isSingBoxBinary(format: RemoteRuleSet['format'], body: Uint8Array): boolean {
  return format === 'singbox' && body.byteLength >= 3 && body[0] === 0x53 && body[1] === 0x52 && body[2] === 0x53
}

function looksLikeHtml(text: string, contentType: string | undefined): boolean {
  const prefix = text.trimStart().slice(0, 200).toLowerCase()
  return contentType === 'text/html' || prefix.startsWith('<!doctype html') || prefix.startsWith('<html')
}

function invalidResult<T extends Omit<RemoteRuleSetValidationResult, 'status' | 'issues' | 'invalidRuleCount'>>(
  base: T,
  validationIssue: RemoteRuleSetValidationIssue
): RemoteRuleSetValidationResult {
  return { ...base, status: 'invalid', invalidRuleCount: 0, issues: [validationIssue] }
}

function issue(
  code: string,
  message: string,
  messageEn: string,
  severity: RemoteRuleSetValidationIssue['severity'] = 'error',
  line?: number
): RemoteRuleSetValidationIssue {
  return { code, severity, message, messageEn, ...(line === undefined ? {} : { line }) }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MiB` : `${Math.round(bytes / 1024)} KiB`
}
