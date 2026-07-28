import { load as parseYaml } from 'js-yaml'
import type { RuleSetBehavior, RuleSetFormat } from '@uni-conf/types'
import { isMihomoMrs, parseMihomoMrs } from './codecs/mihomo-mrs'
import { isSingboxSrs } from './codecs/singbox-srs'

export type RuleSetEncoding = 'text' | 'yaml' | 'json' | 'mrs' | 'srs'

export interface DetectedRuleSetFormat {
  format: RuleSetFormat
  encoding: RuleSetEncoding
  behavior?: RuleSetBehavior
  confidence: 'exact' | 'high' | 'medium'
}

const EGERN_KEYS = new Set([
  'domain_set',
  'domain_suffix_set',
  'domain_keyword_set',
  'domain_regex_set',
  'ip_cidr_set',
  'ip_cidr6_set',
  'dest_port_set',
  'protocol_set',
])

export function detectRuleSetFormat(
  content: string | Uint8Array
): DetectedRuleSetFormat | null {
  if (content instanceof Uint8Array) {
    if (isSingboxSrs(content)) {
      return { format: 'singbox', encoding: 'srs', confidence: 'exact' }
    }
    if (isMihomoMrs(content)) {
      try {
        const parsed = parseMihomoMrs(content)
        return {
          format: 'mrs',
          encoding: 'mrs',
          behavior: parsed.behavior,
          confidence: 'exact',
        }
      } catch {
        return null
      }
    }
    try {
      return detectRuleSetFormat(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content))
    } catch {
      return null
    }
  }

  const trimmed = content.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const document = JSON.parse(trimmed) as unknown
      if (hasRulesArray(document)) {
        return { format: 'singbox', encoding: 'json', confidence: 'high' }
      }
    } catch {
      return null
    }
  }

  try {
    const document = parseYaml(trimmed) as unknown
    if (isRecord(document)) {
      if (Object.keys(document).some(key => EGERN_KEYS.has(key))) {
        return { format: 'egern', encoding: 'yaml', confidence: 'high' }
      }
      if (Array.isArray(document.payload)) {
        return {
          format: 'mihomo',
          encoding: 'yaml',
          behavior: inferBehavior(document.payload),
          confidence: 'high',
        }
      }
    }
  } catch {
    // Plain text formats do not need to be valid YAML.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('//'))
  if (lines.length === 0) return null
  return {
    format: 'text',
    encoding: 'text',
    behavior: inferBehavior(lines),
    confidence: 'medium',
  }
}

function hasRulesArray(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.rules)
}

function inferBehavior(values: unknown[]): RuleSetBehavior {
  const samples = values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().replace(/^[-+]\s+/, ''))
    .filter(Boolean)
    .slice(0, 20)
  if (samples.length === 0) return 'classical'
  if (samples.every(value => isCidr(value))) return 'ipcidr'
  if (samples.every(value => isDomain(value))) return 'domain'
  return 'classical'
}

function isCidr(value: string): boolean {
  return /^.+\/\d{1,3}$/.test(value)
}

function isDomain(value: string): boolean {
  const normalized = value.replace(/^(?:\+\.|\*\.|\.)/, '')
  return Boolean(normalized)
    && !normalized.includes(',')
    && !normalized.includes('/')
    && (normalized === 'localhost' || normalized.includes('.'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
