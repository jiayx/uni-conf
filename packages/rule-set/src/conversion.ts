import * as yaml from 'js-yaml'
import type {
  RuleSetBehavior,
  RuleSetConversionIssue,
  RuleSetConversionMapping,
  RuleSetFormat,
} from '@uni-conf/types'
import { isMihomoMrs, parseMihomoMrs } from './codecs/mihomo-mrs'
import { isSingboxSrs, parseSingboxSrs } from './codecs/singbox-srs'
import { detectRuleSetFormat } from './detect'
import {
  resolveRuleSetRuleForTarget,
  type ConvertibleRuleSetTarget,
} from './rule-compatibility'

export type { ConvertibleRuleSetTarget } from './rule-compatibility'

export interface NormalizedRule {
  type: string
  payload: string
  noResolve?: boolean
  source: string
}

export interface ParsedRuleSet {
  rules: NormalizedRule[]
  skippedRuleTypes: Record<string, number>
  skippedRuleExamples: Record<string, string[]>
}

export interface RuleSetConversionResult {
  content: string
  contentType: string
  convertedRuleCount: number
  skippedRuleCount: number
  skippedRuleTypes: Record<string, number>
  skippedRuleExamples: Record<string, string[]>
  convertedRuleExamples: RuleSetConversionMapping[]
  convertedRuleExamplesTruncated: boolean
}

export interface RuleSetSourceDescriptor {
  format: RuleSetFormat
  behavior: RuleSetBehavior
}

const MAX_SKIPPED_EXAMPLES_PER_TYPE = 3
const MAX_SKIPPED_EXAMPLES_TOTAL = 20
const MAX_DIAGNOSTIC_EXAMPLE_CHARS = 240
const MAX_CONVERTED_EXAMPLES = 20

export function resolveRuleSetConversionIssues(
  result: Pick<RuleSetConversionResult, 'skippedRuleTypes' | 'skippedRuleExamples'>
): RuleSetConversionIssue[] {
  return Object.entries(result.skippedRuleTypes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({
      type,
      count,
      reason: resolveConversionIssueReason(type),
      resolution: resolveConversionIssueResolution(type),
      examples: result.skippedRuleExamples[type] ?? [],
    }))
}

type PortPayload =
  | { kind: 'single'; port: number }
  | { kind: 'range'; range: string }

function parsePortPayload(value: string): PortPayload | null {
  const payload = value.trim()
  const single = /^\d+$/.exec(payload)
  if (single) {
    const port = Number(payload)
    return isValidPort(port) ? { kind: 'single', port } : null
  }
  const range = /^(\d+)\s*[-:]\s*(\d+)$/.exec(payload)
  if (!range) return null
  const start = Number(range[1])
  const end = Number(range[2])
  return isValidPort(start) && isValidPort(end) && start <= end
    ? { kind: 'range', range: `${start}:${end}` }
    : null
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

export function convertRuleSetContent(
  source: RuleSetSourceDescriptor,
  target: ConvertibleRuleSetTarget,
  content: string | Uint8Array
): RuleSetConversionResult {
  const parsed = parseRuleSetContent(source, content)
  if (parsed.rules.length === 0) throw new Error('No safely convertible rules were found')

  if (target === 'singbox') {
    const skippedRuleTypes = { ...parsed.skippedRuleTypes }
    const skippedRuleExamples = cloneExamples(parsed.skippedRuleExamples)
    const convertedRuleExamples: RuleSetConversionMapping[] = []
    let convertedRuleExamplesTruncated = false
    const rules = parsed.rules.flatMap((rule) => {
      const noResolveIsImplicit = rule.noResolve
        && (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6')
      if (rule.noResolve && !noResolveIsImplicit) {
        addSkippedRule(
          skippedRuleTypes,
          skippedRuleExamples,
          `${rule.type}-NO-RESOLVE`,
          formatNormalizedRule(rule)
        )
        return []
      }
      const converted = ruleToSingboxSource(rule)
      if (!converted) addSkippedRule(skippedRuleTypes, skippedRuleExamples, rule.type, formatNormalizedRule(rule))
      else {
        convertedRuleExamplesTruncated ||= addConvertedRuleExample(
          convertedRuleExamples,
          rule.source,
          formatDiagnosticValue(converted)
        )
      }
      return converted ? [converted] : []
    })
    if (rules.length === 0) throw new Error('No rules can be represented safely in sing-box source format')
    return {
      content: JSON.stringify({ version: 3, rules }, null, 2),
      contentType: 'application/json; charset=utf-8',
      convertedRuleCount: rules.length,
      skippedRuleCount: sumCounts(skippedRuleTypes),
      skippedRuleTypes,
      skippedRuleExamples,
      convertedRuleExamples,
      convertedRuleExamplesTruncated,
    }
  }

  if (target === 'egern') {
    return convertToEgernSource(parsed)
  }

  if (target !== 'mihomo') {
    const skippedRuleTypes = { ...parsed.skippedRuleTypes }
    const skippedRuleExamples = cloneExamples(parsed.skippedRuleExamples)
    const convertedRuleExamples: RuleSetConversionMapping[] = []
    let convertedRuleExamplesTruncated = false
    const lines = parsed.rules.flatMap((rule) => {
      const converted = ruleToTextClient(rule, target)
      if (!converted) addSkippedRule(skippedRuleTypes, skippedRuleExamples, rule.type, formatNormalizedRule(rule))
      else {
        if (rule.noResolve && target === 'quantumultx') {
          addSkippedRule(
            skippedRuleTypes,
            skippedRuleExamples,
            `${rule.type}-NO-RESOLVE`,
            formatNormalizedRule(rule)
          )
        }
        convertedRuleExamplesTruncated ||= addConvertedRuleExample(
          convertedRuleExamples,
          rule.source,
          converted
        )
      }
      return converted ? [converted] : []
    })
    if (lines.length === 0) throw new Error(`No rules can be represented safely in ${target} source format`)
    return {
      content: `${lines.join('\n')}\n`,
      contentType: 'text/plain; charset=utf-8',
      convertedRuleCount: lines.length,
      skippedRuleCount: sumCounts(skippedRuleTypes),
      skippedRuleTypes,
      skippedRuleExamples,
      convertedRuleExamples,
      convertedRuleExamplesTruncated,
    }
  }

  const skippedRuleTypes = { ...parsed.skippedRuleTypes }
  const skippedRuleExamples = cloneExamples(parsed.skippedRuleExamples)
  const convertedRuleExamples: RuleSetConversionMapping[] = []
  let convertedRuleExamplesTruncated = false
  const payload = parsed.rules.flatMap((rule) => {
    if (rule.noResolve && source.behavior !== 'classical') {
      addSkippedRule(
        skippedRuleTypes,
        skippedRuleExamples,
        `${rule.type}-NO-RESOLVE`,
        formatNormalizedRule(rule)
      )
      return []
    }
    const converted = ruleToMihomoPayload(rule, source.behavior)
    if (!converted) addSkippedRule(skippedRuleTypes, skippedRuleExamples, rule.type, formatNormalizedRule(rule))
    else {
      convertedRuleExamplesTruncated ||= addConvertedRuleExample(
        convertedRuleExamples,
        rule.source,
        converted
      )
    }
    return converted ? [converted] : []
  })
  if (payload.length === 0) throw new Error('No rules can be represented safely in Mihomo provider format')
  return {
    content: yaml.dump({ payload }, { lineWidth: -1, noRefs: true }),
    contentType: 'text/yaml; charset=utf-8',
    convertedRuleCount: payload.length,
    skippedRuleCount: sumCounts(skippedRuleTypes),
    skippedRuleTypes,
    skippedRuleExamples,
    convertedRuleExamples,
    convertedRuleExamplesTruncated,
  }
}

export function parseRuleSetContent(
  source: RuleSetSourceDescriptor,
  content: string | Uint8Array
): ParsedRuleSet {
  if (content instanceof Uint8Array) {
    if (isSingboxSrs(content)) return parseSingboxContent(content)
    if (isMihomoMrs(content)) return parseMrsSource(content, source.behavior)
    return parseRuleSetContent(
      source,
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content),
    )
  }
  return source.format === 'mrs'
    ? parseMrsSource(content, source.behavior)
    : source.format === 'singbox'
      ? parseSingboxContent(content)
      : source.format === 'egern'
        ? parseEgernSource(requireTextContent(content))
        : source.format === 'text'
          ? parseAutoTextSource(content, source.behavior)
          : parseTextSource(content, source.behavior)
}

function parseAutoTextSource(content: string, behavior: RuleSetBehavior): ParsedRuleSet {
  const detected = detectRuleSetFormat(content)
  if (detected?.format === 'singbox') return parseSingboxSource(content)
  if (detected?.format === 'egern') return parseEgernSource(content)
  return parseTextSource(content, behavior)
}

function parseMrsSource(content: string | Uint8Array, behavior: RuleSetBehavior): ParsedRuleSet {
  if (!(content instanceof Uint8Array)) throw new Error('MRS source must be binary')
  if (behavior === 'classical') throw new Error('MRS does not support classical behavior')
  const parsed = parseMihomoMrs(content, { expectedBehavior: behavior })
  return parseTextSource(parsed.rules.join('\n'), parsed.behavior)
}

function requireTextContent(content: string | Uint8Array): string {
  if (typeof content !== 'string') throw new Error('Text rule-set source must be UTF-8')
  return content
}

function parseSingboxContent(content: string | Uint8Array): ParsedRuleSet {
  if (content instanceof Uint8Array) {
    const parsed = parseSingboxSrs(content)
    return parseSingboxRules(parsed.rules)
  }
  return parseSingboxSource(content)
}

function parseEgernSource(content: string): ParsedRuleSet {
  const document = yaml.load(content) as unknown
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Egern source rule set must be a YAML object')
  }
  const source = document as Record<string, unknown>
  const mappings: Array<[string, string]> = [
    ['domain_set', 'DOMAIN'], ['domain_suffix_set', 'DOMAIN-SUFFIX'],
    ['domain_keyword_set', 'DOMAIN-KEYWORD'], ['domain_regex_set', 'DOMAIN-REGEX'],
    ['ip_cidr_set', 'IP-CIDR'], ['ip_cidr6_set', 'IP-CIDR6'],
    ['dest_port_set', 'DST-PORT'], ['protocol_set', 'PROTOCOL'],
  ]
  const knownKeys = new Set([...mappings.map(([key]) => key), 'no_resolve'])
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
  for (const [key, type] of mappings) {
    const values = source[key]
    if (values === undefined) continue
    if (!Array.isArray(values)) {
      addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${formatEgernRuleType(key)}`, `${key}: ${formatDiagnosticValue(values)}`)
      continue
    }
    for (const value of values) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${type}`, `${key}: ${formatDiagnosticValue(value)}`)
        continue
      }
      const rule: NormalizedRule = {
        type,
        payload: String(value),
        noResolve: Boolean(source['no_resolve']) && (type === 'IP-CIDR' || type === 'IP-CIDR6'),
        source: formatDiagnosticValue(`${key}: ${formatDiagnosticValue(value)}`),
      }
      if (isValidNormalizedRule(rule)) rules.push(rule)
      else addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${type}`, `${key}: ${formatDiagnosticValue(value)}`)
    }
  }
  for (const [key, value] of Object.entries(source)) {
    if (!knownKeys.has(key) && isPopulatedCondition(value)) {
      const count = Array.isArray(value) ? Math.max(value.length, 1) : 1
      addSkippedRule(
        skippedRuleTypes,
        skippedRuleExamples,
        formatEgernRuleType(key),
        `${key}: ${formatDiagnosticValue(value)}`,
        count
      )
    }
  }
  return { rules, skippedRuleTypes, skippedRuleExamples }
}

function convertToEgernSource(
  parsed: ParsedRuleSet
): RuleSetConversionResult {
  const mappings: Record<string, string> = {
    DOMAIN: 'domain_set', 'DOMAIN-SUFFIX': 'domain_suffix_set',
    'DOMAIN-KEYWORD': 'domain_keyword_set', 'DOMAIN-REGEX': 'domain_regex_set',
    'IP-CIDR': 'ip_cidr_set', 'IP-CIDR6': 'ip_cidr6_set',
    'DST-PORT': 'dest_port_set', PROTOCOL: 'protocol_set',
  }
  const result: Record<string, Array<string | number>> = {}
  const skippedRuleTypes = { ...parsed.skippedRuleTypes }
  const skippedRuleExamples = cloneExamples(parsed.skippedRuleExamples)
  const convertedRuleExamples: RuleSetConversionMapping[] = []
  let convertedRuleExamplesTruncated = false
  let convertedRuleCount = 0
  for (const rule of parsed.rules) {
    const resolution = rule.type === 'NETWORK' || rule.type === 'PROTOCOL'
      ? resolveRuleSetRuleForTarget(rule.type, rule.payload, 'egern')
      : { level: 'full' as const, type: rule.type, payload: rule.payload }
    const key = resolution.level === 'unsupported' ? undefined : mappings[resolution.type]
    const supportedProtocol = key !== 'protocol_set'
      || ['tcp', 'udp', 'http', 'https', 'quic', 'stun'].includes(resolution.payload.toLowerCase())
    // Egern's no_resolve is set-wide; applying it to a mixed source would alter other rules.
    if (!key || !supportedProtocol || rule.noResolve) {
      addSkippedRule(
        skippedRuleTypes,
        skippedRuleExamples,
        rule.noResolve ? `${rule.type}-NO-RESOLVE` : rule.type,
        formatNormalizedRule(rule)
      )
      continue
    }
    const value = key === 'dest_port_set' && /^\d+$/.test(resolution.payload)
      ? Number(resolution.payload)
      : key === 'protocol_set' ? resolution.payload.toLowerCase() : resolution.payload
    ;(result[key] ??= []).push(value)
    convertedRuleExamplesTruncated ||= addConvertedRuleExample(
      convertedRuleExamples,
      rule.source,
      `${key}: ${formatDiagnosticValue(value)}`
    )
    convertedRuleCount += 1
  }
  if (convertedRuleCount === 0) throw new Error('No rules can be represented safely in Egern source format')
  return {
    content: yaml.dump(result, { lineWidth: -1, noRefs: true }),
    contentType: 'text/yaml; charset=utf-8',
    convertedRuleCount,
    skippedRuleCount: sumCounts(skippedRuleTypes),
    skippedRuleTypes,
    skippedRuleExamples,
    convertedRuleExamples,
    convertedRuleExamplesTruncated,
  }
}

function formatEgernRuleType(key: string): string {
  return key.replace(/_set$/i, '').replace(/_/g, '-').toUpperCase()
}

function parseTextSource(content: string, behavior: RuleSetBehavior): ParsedRuleSet {
  const values = extractTextRuleValues(content)
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
  for (const value of values) {
    if (typeof value !== 'string') {
      addSkippedRule(
        skippedRuleTypes,
        skippedRuleExamples,
        behavior === 'domain' ? 'INVALID-DOMAIN' : behavior === 'ipcidr' ? 'INVALID-CIDR' : 'INVALID',
        formatDiagnosticValue(value),
      )
      continue
    }
    const rule = normalizeTextRule(value, behavior)
    if (rule) rules.push(rule)
    else addSkippedRule(skippedRuleTypes, skippedRuleExamples, skippedTextRuleReason(value, behavior), value)
  }
  return { rules, skippedRuleTypes, skippedRuleExamples }
}

function extractTextRuleValues(content: string): unknown[] {
  try {
    const document = yaml.load(content) as unknown
    if (document && typeof document === 'object' && !Array.isArray(document)) {
      const payload = (document as Record<string, unknown>)['payload']
      if (Array.isArray(payload)) return payload
      if (payload !== undefined) return [payload]
    }
    if (Array.isArray(document)) return document
  } catch {
    // Plain lists are handled line by line below.
  }
  return content.split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-+]\s+/, ''))
    .filter((line) => Boolean(line) && !line.startsWith('#') && !line.startsWith('//'))
}

function normalizeTextRule(value: string, behavior: RuleSetBehavior): NormalizedRule | null {
  const text = value.trim()
  if (!text) return null
  if (behavior === 'domain') {
    const suffix = text.startsWith('+.') ? text.slice(2) : text.startsWith('.') ? text.slice(1) : null
    const payload = suffix ?? text
    if (!isValidDomainPayload(payload)) return null
    return { type: suffix === null ? 'DOMAIN' : 'DOMAIN-SUFFIX', payload, source: formatDiagnosticValue(text) }
  }
  if (behavior === 'ipcidr') {
    if (!isValidCidr(text)) return null
    return {
      type: text.includes(':') ? 'IP-CIDR6' : 'IP-CIDR',
      payload: text,
      source: formatDiagnosticValue(text),
    }
  }
  const [rawType, rawPayload, ...options] = text.split(',').map((part) => part.trim())
  if (!rawType || !rawPayload || !/^[A-Z][A-Z0-9-]*$/.test(rawType)) return null
  const typeAliases: Record<string, string> = {
    HOST: 'DOMAIN',
    'HOST-SUFFIX': 'DOMAIN-SUFFIX',
    'HOST-KEYWORD': 'DOMAIN-KEYWORD',
    'IP6-CIDR': 'IP-CIDR6',
    PORT: 'DST-PORT',
    'DEST-PORT': 'DST-PORT',
  }
  const normalizedOptions = options.map(option => option.toLowerCase()).filter(Boolean)
  if (normalizedOptions.some(option => option !== 'no-resolve' && option !== 'src')) return null
  let type = typeAliases[rawType] ?? rawType
  const sourceMatch = normalizedOptions.includes('src')
  const noResolve = normalizedOptions.includes('no-resolve')
  if (sourceMatch) {
    if (!['IP-CIDR', 'IP-CIDR6'].includes(type) || noResolve) return null
    type = 'SRC-IP-CIDR'
  } else if (noResolve && !['IP-CIDR', 'IP-CIDR6'].includes(type)) {
    return null
  }
  const normalizedPayload = type === 'DST-PORT' || type === 'SRC-PORT'
    ? normalizePortPayload(rawPayload)
    : rawPayload
  if (normalizedPayload === null) return null
  const rule = { type, payload: normalizedPayload, noResolve, source: formatDiagnosticValue(text) }
  return isValidNormalizedRule(rule) ? rule : null
}

function parseSingboxSource(content: string): ParsedRuleSet {
  const document = JSON.parse(content) as { rules?: unknown[] }
  if (!Array.isArray(document.rules)) throw new Error('sing-box source rule set has no rules array')
  return parseSingboxRules(document.rules)
}

function parseSingboxRules(sourceRules: unknown[]): ParsedRuleSet {
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
  for (const item of sourceRules) {
    const converted = normalizeSingboxRule(item)
    rules.push(...converted.rules)
    mergeCounts(skippedRuleTypes, converted.skippedRuleTypes)
    mergeExamples(skippedRuleExamples, converted.skippedRuleExamples)
  }
  return { rules, skippedRuleTypes, skippedRuleExamples }
}

function normalizeSingboxRule(value: unknown): ParsedRuleSet {
  const example = formatDiagnosticValue(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return skippedSingboxRule('INVALID', example)
  const rule = value as Record<string, unknown>
  if (rule['invert']) return skippedSingboxRule('INVERT', example)
  if (rule['action']) return skippedSingboxRule('ACTION', example)
  if (rule['rule_set']) return skippedSingboxRule('RULE-SET', example)
  const mappings: Array<[string, string]> = [
    ['domain', 'DOMAIN'], ['domain_suffix', 'DOMAIN-SUFFIX'], ['domain_keyword', 'DOMAIN-KEYWORD'],
    ['domain_regex', 'DOMAIN-REGEX'], ['ip_cidr', 'IP-CIDR'], ['source_ip_cidr', 'SRC-IP-CIDR'],
    ['port', 'DST-PORT'], ['port_range', 'DST-PORT'],
    ['source_port', 'SRC-PORT'], ['source_port_range', 'SRC-PORT'],
    ['network', 'NETWORK'], ['protocol', 'PROTOCOL'],
  ]
  const conditionFamilies = [
    ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'],
    ['ip_cidr'],
    ['source_ip_cidr'],
    ['port', 'port_range'],
    ['source_port', 'source_port_range'],
    ['network'],
    ['protocol'],
  ]
  const populatedFamilies = conditionFamilies
    .map(keys => mappings.filter(([key]) => keys.includes(key) && Array.isArray(rule[key]) && (rule[key] as unknown[]).length > 0))
    .filter(family => family.length > 0)
  const knownKeys = new Set(mappings.map(([key]) => key))
  const unknownKeys = Object.entries(rule)
    .filter(([key, item]) => key !== 'type' && !knownKeys.has(key) && isPopulatedCondition(item))
    .map(([key]) => key)
  // Items within one condition family are OR; different families are AND.
  if (populatedFamilies.length + unknownKeys.length !== 1) return skippedSingboxRule('COMPOUND', example)
  if (unknownKeys.length === 1) return skippedSingboxRule(formatSingboxRuleType(unknownKeys[0]!), example)
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
  for (const [key, type] of populatedFamilies[0]!) {
    for (const item of rule[key] as unknown[]) {
      if (typeof item !== 'string' && typeof item !== 'number') {
        addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${type}`, example)
        continue
      }
      const rawPayload = String(item)
      const portKind = key === 'port' || key === 'source_port'
        ? 'single'
        : key === 'port_range' || key === 'source_port_range'
          ? 'range'
          : null
      const parsedPort = portKind ? parsePortPayload(rawPayload) : null
      if (portKind && (!parsedPort || parsedPort.kind !== portKind)) {
        addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${type}`, example)
        continue
      }
      const payload = parsedPort
        ? parsedPort.kind === 'single' ? String(parsedPort.port) : parsedPort.range.replace(':', '-')
        : rawPayload
      const resolvedType = type === 'IP-CIDR' && payload.includes(':') ? 'IP-CIDR6' : type
      const normalized = { type: resolvedType, payload, source: example }
      if (isValidNormalizedRule(normalized)) rules.push(normalized)
      else addSkippedRule(skippedRuleTypes, skippedRuleExamples, `INVALID-${resolvedType}`, example)
    }
  }
  return { rules, skippedRuleTypes, skippedRuleExamples }
}

function ruleToSingboxSource(rule: NormalizedRule): Record<string, unknown> | null {
  if (rule.type === 'NETWORK' || rule.type === 'PROTOCOL') {
    const resolution = resolveRuleSetRuleForTarget(rule.type, rule.payload, 'singbox')
    if (resolution.level === 'unsupported') return null
    const key = resolution.type === 'NETWORK'
      ? 'network'
      : resolution.type === 'PROTOCOL'
        ? 'protocol'
        : null
    return key ? { [key]: [resolution.payload] } : null
  }
  const mappings: Record<string, string> = {
    DOMAIN: 'domain', 'DOMAIN-SUFFIX': 'domain_suffix', 'DOMAIN-KEYWORD': 'domain_keyword',
    'DOMAIN-REGEX': 'domain_regex', 'IP-CIDR': 'ip_cidr', 'IP-CIDR6': 'ip_cidr',
    'SRC-IP-CIDR': 'source_ip_cidr',
  }
  if (rule.type === 'DST-PORT' || rule.type === 'SRC-PORT') {
    const parsed = parsePortPayload(rule.payload)
    if (!parsed) return null
    const field = rule.type === 'DST-PORT' ? 'port' : 'source_port'
    return parsed.kind === 'single'
      ? { [field]: [parsed.port] }
      : { [`${field}_range`]: [parsed.range] }
  }
  const key = mappings[rule.type]
  if (!key) return null
  return { [key]: [rule.payload] }
}

function ruleToTextClient(
  rule: NormalizedRule,
  target: Exclude<ConvertibleRuleSetTarget, 'mihomo' | 'singbox'>
): string | null {
  if (rule.type === 'NETWORK' || rule.type === 'PROTOCOL') {
    const resolution = resolveRuleSetRuleForTarget(rule.type, rule.payload, target)
    return resolution.level === 'unsupported'
      ? null
      : `${resolution.type},${resolution.payload}`
  }
  const portableTypes = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6'])
  let targetType: string
  if (portableTypes.has(rule.type)) {
    targetType = target === 'quantumultx'
      ? ({ DOMAIN: 'HOST', 'DOMAIN-SUFFIX': 'HOST-SUFFIX', 'DOMAIN-KEYWORD': 'HOST-KEYWORD', 'IP-CIDR6': 'IP6-CIDR' }[rule.type] ?? rule.type)
      : rule.type
  } else if (rule.type === 'DST-PORT') {
    if (target === 'quantumultx') return null
    targetType = target === 'surge' || target === 'loon' ? 'DEST-PORT' : 'DST-PORT'
  } else if (rule.type === 'SRC-PORT') {
    if (target !== 'surge' && target !== 'loon') return null
    targetType = 'SRC-PORT'
  } else {
    return null
  }
  const noResolve = rule.noResolve && target !== 'quantumultx' ? ',no-resolve' : ''
  return `${targetType},${rule.payload}${noResolve}`
}

function ruleToMihomoPayload(rule: NormalizedRule, behavior: RuleSetBehavior): string | null {
  if (behavior === 'domain') {
    if (rule.type === 'DOMAIN-SUFFIX') return `+.${rule.payload}`
    return rule.type === 'DOMAIN' ? rule.payload : null
  }
  if (behavior === 'ipcidr') {
    return rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6' ? rule.payload : null
  }
  if (rule.type === 'NETWORK' || rule.type === 'PROTOCOL') {
    const resolution = resolveRuleSetRuleForTarget(rule.type, rule.payload, 'mihomo')
    return resolution.level === 'unsupported'
      ? null
      : `${resolution.type},${resolution.payload}`
  }
  const supported = new Set([
    'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX',
    'IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR', 'DST-PORT', 'SRC-PORT',
  ])
  if (!supported.has(rule.type)) return null
  return `${rule.type},${rule.payload}${rule.noResolve ? ',no-resolve' : ''}`
}

function skippedTextRuleReason(value: string, behavior: RuleSetBehavior): string {
  if (behavior === 'domain') return 'INVALID-DOMAIN'
  if (behavior === 'ipcidr') return 'INVALID-CIDR'
  const rawType = value.split(',', 1)[0]?.trim().toUpperCase() ?? ''
  if (!/^[A-Z][A-Z0-9-]*$/.test(rawType)) return 'INVALID'
  const aliases: Record<string, string> = {
    HOST: 'DOMAIN', 'HOST-SUFFIX': 'DOMAIN-SUFFIX', 'HOST-KEYWORD': 'DOMAIN-KEYWORD',
    'IP6-CIDR': 'IP-CIDR6', PORT: 'DST-PORT', 'DEST-PORT': 'DST-PORT',
  }
  const type = aliases[rawType] ?? rawType
  const options = value.split(',').slice(2).map(option => option.trim().toLowerCase()).filter(Boolean)
  const unknownOption = options.find(option => option !== 'no-resolve' && option !== 'src')
  if (unknownOption) return `${type}-OPTION-${formatOptionName(unknownOption)}`
  if (options.includes('src')) {
    if (!['IP-CIDR', 'IP-CIDR6'].includes(type)) return `${type}-OPTION-SRC`
    if (options.includes('no-resolve')) return 'SRC-IP-CIDR-NO-RESOLVE'
  }
  if (options.includes('no-resolve') && !['IP-CIDR', 'IP-CIDR6'].includes(type)) {
    return `${type}-OPTION-NO-RESOLVE`
  }
  return `INVALID-${type}`
}

function formatOptionName(value: string): string {
  return value.replaceAll('_', '-').replace(/[^a-z0-9-]/gi, '').toUpperCase() || 'UNKNOWN'
}

function isValidNormalizedRule(rule: NormalizedRule): boolean {
  if (rule.type === 'DOMAIN' || rule.type === 'DOMAIN-SUFFIX') return isValidDomainPayload(rule.payload)
  if (rule.type === 'DOMAIN-KEYWORD') return Boolean(rule.payload) && !/[\s,]/.test(rule.payload)
  if (rule.type === 'DOMAIN-REGEX') {
    try {
      new RegExp(rule.payload)
      return true
    } catch {
      return false
    }
  }
  if (['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR'].includes(rule.type)) return isValidCidr(rule.payload)
  if (rule.type === 'DST-PORT' || rule.type === 'SRC-PORT') return isValidPortSelector(rule.payload)
  if (rule.type === 'NETWORK') return ['tcp', 'udp', 'icmp'].includes(rule.payload.toLowerCase())
  if (rule.type === 'PROTOCOL') return /^[a-z0-9][a-z0-9_-]*$/i.test(rule.payload)
  return Boolean(rule.payload)
}

function isValidDomainPayload(value: string): boolean {
  const payload = value.trim()
  if (!payload || payload.length > 253 || /[\s,/:?#*]/.test(payload)) return false
  try {
    const hostname = new URL(`http://${payload}/`).hostname
    return Boolean(hostname) && hostname !== '.'
  } catch {
    return false
  }
}

function isValidCidr(value: string): boolean {
  const match = value.trim().match(/^(.+)\/(\d{1,3})$/)
  if (!match) return false
  const address = match[1]!
  const prefix = Number(match[2])
  if (address.includes(':')) {
    if (prefix < 0 || prefix > 128 || !/^[\da-f:.]+$/i.test(address)) return false
    try {
      new URL(`http://[${address}]/`)
      return true
    } catch {
      return false
    }
  }
  if (prefix < 0 || prefix > 32) return false
  const octets = address.split('.')
  return octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isValidPortSelector(value: string): boolean {
  return parsePortPayload(value) !== null
}

function normalizePortPayload(value: string): string | null {
  const parsed = parsePortPayload(value)
  if (!parsed) return null
  return parsed.kind === 'single' ? String(parsed.port) : parsed.range.replace(':', '-')
}

function skippedSingboxRule(reason: string, example: string): ParsedRuleSet {
  return { rules: [], skippedRuleTypes: { [reason]: 1 }, skippedRuleExamples: { [reason]: [example] } }
}

function isPopulatedCondition(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'number') return true
  if (typeof value === 'boolean') return value
  return value !== null && value !== undefined
}

function formatSingboxRuleType(value: string): string {
  return value.replaceAll('_', '-').toUpperCase()
}

function incrementCount(counts: Record<string, number>, type: string, amount = 1): void {
  counts[type] = (counts[type] ?? 0) + amount
}

function addSkippedRule(
  counts: Record<string, number>,
  examples: Record<string, string[]>,
  type: string,
  example: string,
  amount = 1
): void {
  incrementCount(counts, type, amount)
  const existing = examples[type] ?? []
  const totalExamples = Object.values(examples).reduce((sum, items) => sum + items.length, 0)
  if (
    existing.length >= MAX_SKIPPED_EXAMPLES_PER_TYPE
    || totalExamples >= MAX_SKIPPED_EXAMPLES_TOTAL
    || existing.includes(example)
  ) return
  examples[type] = [...existing, example]
}

function addConvertedRuleExample(
  examples: RuleSetConversionMapping[],
  source: string,
  target: string
): boolean {
  const normalized = {
    source: formatDiagnosticValue(source),
    target: formatDiagnosticValue(target),
  }
  if (examples.some(item => item.source === normalized.source && item.target === normalized.target)) return false
  if (examples.length >= MAX_CONVERTED_EXAMPLES) return true
  examples.push(normalized)
  return false
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [type, count] of Object.entries(source)) incrementCount(target, type, count)
}

function mergeExamples(target: Record<string, string[]>, source: Record<string, string[]>): void {
  for (const [type, values] of Object.entries(source)) {
    for (const value of values) {
      const existing = target[type] ?? []
      const totalExamples = Object.values(target).reduce((sum, items) => sum + items.length, 0)
      if (existing.length >= MAX_SKIPPED_EXAMPLES_PER_TYPE || totalExamples >= MAX_SKIPPED_EXAMPLES_TOTAL) break
      if (!existing.includes(value)) target[type] = [...existing, value]
    }
  }
}

function cloneExamples(source: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(source).map(([type, values]) => [type, [...values]]))
}

function formatNormalizedRule(rule: NormalizedRule): string {
  return formatDiagnosticValue(`${rule.type},${rule.payload}${rule.noResolve ? ',no-resolve' : ''}`)
}

function formatDiagnosticValue(value: unknown): string {
  let formatted: string
  if (typeof value === 'string') formatted = value
  else {
    try {
      formatted = JSON.stringify(value) ?? String(value)
    } catch {
      formatted = String(value)
    }
  }
  const compact = formatted.replace(/\s+/g, ' ').trim()
  return compact.length > MAX_DIAGNOSTIC_EXAMPLE_CHARS
    ? `${compact.slice(0, MAX_DIAGNOSTIC_EXAMPLE_CHARS - 1)}…`
    : compact
}

export function resolveConversionIssueReason(type: string): RuleSetConversionIssue['reason'] {
  if (type === 'COMPOUND') return 'compound-condition'
  if (type.startsWith('INVALID')) return 'invalid-rule'
  if (type.endsWith('-NO-RESOLVE') || type.includes('-OPTION-')) return 'unsupported-option'
  return 'unsupported-directive'
}

export function resolveConversionIssueResolution(type: string): RuleSetConversionIssue['resolution'] {
  if (type.startsWith('INVALID')) return 'repair-source-rule'
  if (type.endsWith('-NO-RESOLVE') || type.includes('-OPTION-')) return 'remove-unsupported-option'
  return 'use-native-source'
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}
