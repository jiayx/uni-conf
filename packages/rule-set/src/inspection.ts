import { load as parseYaml } from 'js-yaml'
import type { RuleSetBehavior, RuleSetFormat } from '@uni-conf/types'
import { isMihomoMrs, parseMihomoMrs } from './codecs/mihomo-mrs'
import { isSingboxSrs, parseSingboxSrs } from './codecs/singbox-srs'
import {
  EGERN_RULE_SET_KEYS,
  resolveTextRuleSetFormat,
  type DetectedRuleSetFormat,
} from './detect'

export type RuleSetInspectionMode = 'text' | 'structured'

export type RuleSetInspectionParseError =
  | 'invalid_structure'
  | 'invalid_yaml'
  | 'invalid_json'

export type RuleSetContentInspectionError =
  | RuleSetInspectionParseError
  | 'invalid_behavior'
  | 'invalid_encoding'
  | 'invalid_mrs'
  | 'invalid_srs'
  | 'html_response'

export interface ParsedRuleSetInspection {
  mode: RuleSetInspectionMode
  rules?: unknown[]
  error?: RuleSetInspectionParseError
}

export interface RuleSetInspectionIssue {
  code: 'invalid_rule'
  line: number
}

export interface RuleSetContentInspection {
  detected: DetectedRuleSetFormat
  mode: RuleSetInspectionMode
  rules: unknown[]
  issues: RuleSetInspectionIssue[]
  error?: RuleSetContentInspectionError
}

interface EgernRuleValue {
  __uniConfEgernKey: string
  value: unknown
}

export function parseRuleSetForInspection(
  text: string,
  format: RuleSetFormat
): ParsedRuleSetInspection {
  const trimmed = text.trim()
  if (format === 'egern') {
    try {
      const rules = extractEgernRules(parseYaml(trimmed))
      return rules
        ? { mode: 'structured', rules }
        : { mode: 'structured', error: 'invalid_structure' }
    } catch {
      return { mode: 'structured', error: 'invalid_yaml' }
    }
  }

  if (format === 'singbox' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const rules = extractStructuredRules(JSON.parse(trimmed))
      return rules
        ? { mode: 'structured', rules }
        : { mode: 'structured', error: 'invalid_structure' }
    } catch {
      if (format === 'singbox') return { mode: 'structured', error: 'invalid_json' }
    }
  }

  if (/^(payload|rules|domain_set|ip_cidr|ip_cidr_set)\s*:/m.test(trimmed)) {
    try {
      const rules = extractStructuredRules(parseYaml(trimmed))
      return rules
        ? { mode: 'structured', rules }
        : { mode: 'structured', error: 'invalid_structure' }
    } catch {
      return { mode: 'structured', error: 'invalid_yaml' }
    }
  }

  return { mode: 'text', rules: extractTextRules(text) }
}

export function inspectRuleSetValues(
  rules: unknown[],
  behavior: RuleSetBehavior
): RuleSetInspectionIssue[] {
  const issues: RuleSetInspectionIssue[] = []
  for (const [index, value] of rules.entries()) {
    const valid = isRecord(value)
      ? isValidStructuredRule(value, behavior)
      : typeof value === 'string' && isValidRule(value.trim(), behavior)
    if (!valid) issues.push({ code: 'invalid_rule', line: index + 1 })
  }
  return issues
}

export function inspectRuleSetContent(
  content: string | Uint8Array,
  options: {
    format: RuleSetFormat
    behavior: RuleSetBehavior
    contentType?: string
  }
): RuleSetContentInspection {
  if (content instanceof Uint8Array) {
    if (isSingboxSrs(content)) {
      try {
        const parsed = parseSingboxSrs(content)
        return inspectedResult(
          { format: 'singbox', encoding: 'srs', confidence: 'exact' },
          'structured',
          parsed.rules,
          options.behavior,
        )
      } catch {
        return inspectionError(
          { format: 'singbox', encoding: 'srs', confidence: 'exact' },
          'invalid_srs',
        )
      }
    }

    if (options.format === 'mrs' || isMihomoMrs(content)) {
      if (options.behavior === 'classical') {
        return inspectionError(
          { format: 'mrs', encoding: 'mrs', confidence: 'exact' },
          'invalid_behavior',
        )
      }
      try {
        const parsed = parseMihomoMrs(content, { expectedBehavior: options.behavior })
        return inspectedResult(
          {
            format: 'mrs',
            encoding: 'mrs',
            behavior: parsed.behavior,
            confidence: 'exact',
          },
          'structured',
          parsed.rules,
          parsed.behavior,
        )
      } catch {
        return inspectionError(
          { format: 'mrs', encoding: 'mrs', confidence: 'exact' },
          'invalid_mrs',
        )
      }
    }

    try {
      return inspectRuleSetContent(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content),
        options,
      )
    } catch {
      return inspectionError(
        { format: options.format, encoding: 'text', confidence: 'medium' },
        'invalid_encoding',
      )
    }
  }

  if (looksLikeHtml(content, options.contentType)) {
    return inspectionError(
      { format: options.format, encoding: 'text', confidence: 'medium' },
      'html_response',
    )
  }

  const detected = resolveTextRuleSetFormat(content, options.format, options.behavior)
  const parsed = parseRuleSetForInspection(content, detected.format)
  if (parsed.error) return inspectionError(detected, parsed.error)
  return inspectedResult(detected, parsed.mode, parsed.rules ?? [], options.behavior)
}

function inspectedResult(
  detected: DetectedRuleSetFormat,
  mode: RuleSetInspectionMode,
  rules: unknown[],
  behavior: RuleSetBehavior
): RuleSetContentInspection {
  return {
    detected,
    mode,
    rules,
    issues: inspectRuleSetValues(rules, behavior),
  }
}

function inspectionError(
  detected: DetectedRuleSetFormat,
  error: RuleSetContentInspectionError
): RuleSetContentInspection {
  return { detected, mode: 'structured', rules: [], issues: [], error }
}

function looksLikeHtml(text: string, contentType: string | undefined): boolean {
  const prefix = text.trimStart().slice(0, 200).toLowerCase()
  return contentType === 'text/html' || prefix.startsWith('<!doctype html') || prefix.startsWith('<html')
}

function extractEgernRules(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null
  const presentKeys = [...EGERN_RULE_SET_KEYS].filter(key => key in value)
  if (presentKeys.length === 0) return null
  return presentKeys.flatMap((key): EgernRuleValue[] => {
    const values = value[key]
    if (!Array.isArray(values)) return [{ __uniConfEgernKey: key, value: values }]
    return values.map(item => ({ __uniConfEgernKey: key, value: item }))
  })
}

function extractStructuredRules(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return null
  for (const key of ['payload', 'rules', 'domain_set', 'ip_cidr']) {
    if (Array.isArray(value[key])) return value[key]
  }
  return null
}

function extractTextRules(text: string): string[] {
  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => Boolean(line) && !line.startsWith('#') && !line.startsWith('//') && !line.startsWith(';'))
}

function isValidStructuredRule(value: Record<string, unknown>, behavior: RuleSetBehavior): boolean {
  if (isEgernRuleValue(value)) return isValidEgernRuleValue(value, behavior)
  if (Object.keys(value).length === 0) return false
  if (behavior === 'classical') return true
  const expectedKeys = behavior === 'domain'
    ? ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'geosite']
    : ['ip_cidr', 'ip_is_private', 'geoip', 'source_ip_cidr']
  return expectedKeys.some(key => key in value)
}

function isEgernRuleValue(value: Record<string, unknown>): value is EgernRuleValue & Record<string, unknown> {
  return typeof value.__uniConfEgernKey === 'string' && 'value' in value
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
    try {
      new RegExp(value)
      return true
    } catch {
      return false
    }
  }
  if (key === 'dest_port_set') {
    return (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535)
      || (typeof value === 'string' && isValidPortSelector(value))
  }
  if (key === 'protocol_set') {
    return typeof value === 'string'
      && ['tcp', 'udp', 'http', 'https', 'quic', 'stun'].includes(value.toLowerCase())
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
  return normalized === 'localhost'
    || /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9_][a-z0-9_-]*$/i.test(normalized)
}

function isIpCidr(value: string): boolean {
  const [address, prefixText, extra] = value.split('/')
  if (extra !== undefined || !address || prefixText === undefined || !/^\d+$/.test(prefixText)) return false
  const prefix = Number(prefixText)
  if (address.includes(':')) return isValidIpv6(address) && prefix >= 0 && prefix <= 128
  const octets = address.split('.')
  return prefix >= 0
    && prefix <= 32
    && octets.length === 4
    && octets.every(part => /^\d+$/.test(part) && Number(part) <= 255)
}

function isValidIpv6(address: string): boolean {
  try {
    const parsed = new URL(`http://[${address}]/`)
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
