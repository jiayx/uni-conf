import * as yaml from 'js-yaml'
import type { CompatibilityWarning, ExportFormat, RemoteRuleSet, RemoteRuleSetConversionIssue, RemoteRuleSetConversionMapping, RuleSetConversionPolicy, RuleSetFormat } from '@uni-conf/types'
import { getRuleSetConversionTargetFormat, isRuleSetFormatCompatible, parseRulePortPayload, resolveRemoteRuleSetForExport, resolveRuleForExport } from '@uni-conf/shared'
import type { ExportData } from '../export-data'
import { safeRemoteFetch } from './safe-remote-fetch'
import { mapWithConcurrency } from './async-pool'
import { buildPrivateCacheKey } from './private-cache-key'

export type ConvertibleRuleSetTarget = 'mihomo' | 'singbox' | 'surge' | 'loon' | 'shadowrocket' | 'quantumultx' | 'egern'

interface NormalizedRule {
  type: string
  payload: string
  noResolve?: boolean
  source: string
}

interface ParsedRuleSet {
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
  convertedRuleExamples: RemoteRuleSetConversionMapping[]
  convertedRuleExamplesTruncated: boolean
}

export class RuleSetConversionError extends Error {
  constructor(
    public readonly code: 'download_failed' | 'too_large' | 'invalid_content',
    message: string
  ) {
    super(message)
    this.name = 'RuleSetConversionError'
  }
}

type RuleSetConversionFailureCode = RuleSetConversionError['code'] | 'unexpected'

const MAX_CONVERTIBLE_RULE_SET_BYTES = 4 * 1024 * 1024
const MAX_SKIPPED_EXAMPLES_PER_TYPE = 3
const MAX_SKIPPED_EXAMPLES_TOTAL = 20
const MAX_DIAGNOSTIC_EXAMPLE_CHARS = 240
const MAX_CONVERTED_EXAMPLES = 20

export function resolveRuleSetConversionIssues(
  result: Pick<RuleSetConversionResult, 'skippedRuleTypes' | 'skippedRuleExamples'>
): RemoteRuleSetConversionIssue[] {
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

export function resolveConvertibleRuleSetTarget(
  sourceFormat: RuleSetFormat,
  exportFormat: ExportFormat
): ConvertibleRuleSetTarget | null {
  return getRuleSetConversionTargetFormat(sourceFormat, exportFormat)
}

export function resolveRuleSetConversionSource(
  ruleSet: RemoteRuleSet,
  exportFormat: ExportFormat
): { source: RemoteRuleSet; target: ConvertibleRuleSetTarget } | null {
  const resolved = resolveRemoteRuleSetForExport(ruleSet, exportFormat)
  if (!resolved || isRuleSetFormatCompatible(exportFormat, resolved.format)) return null
  const target = resolveConvertibleRuleSetTarget(resolved.format, exportFormat)
  if (!target) return null
  return {
    source: { ...ruleSet, url: resolved.url, format: resolved.format as RuleSetFormat },
    target,
  }
}

export async function getConvertedRemoteRuleSet(
  source: RemoteRuleSet,
  target: ConvertibleRuleSetTarget,
  options: { fetcher?: typeof fetch; kv?: KVNamespace; timeoutMs?: number; bypassCache?: boolean } = {}
): Promise<RuleSetConversionResult> {
  const cacheKey = await buildPrivateCacheKey(
    'converted-rule-set',
    10,
    `${source.url}|${source.format}|${source.behavior}|${target}`
  )
  const cached = options.bypassCache ? null : await options.kv?.get(cacheKey)
  if (cached) {
    const parsed = parseCachedConversionResult(cached)
    if (parsed) return parsed
    // Ignore corrupt or stale cache entries and rebuild them.
  }

  let response: Response
  try {
    response = await safeRemoteFetch(options.fetcher ?? fetch, source.url, {
      headers: { Accept: 'application/json, text/yaml, text/plain, */*', 'User-Agent': 'UniConf/1.0' },
    }, { timeoutMs: options.timeoutMs ?? 10_000 })
  } catch {
    throw new RuleSetConversionError('download_failed', 'Rule set download failed')
  }
  if (!response.ok) {
    throw new RuleSetConversionError('download_failed', `Upstream rule set returned HTTP ${response.status}`)
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_CONVERTIBLE_RULE_SET_BYTES) {
    throw new RuleSetConversionError('too_large', 'Rule set is too large to convert')
  }

  let content: string
  try {
    const bytes = await readResponseBytesLimited(response, MAX_CONVERTIBLE_RULE_SET_BYTES)
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch (error) {
    if (error instanceof RuleSetConversionError) throw error
    throw new RuleSetConversionError('invalid_content', 'Rule set is not valid UTF-8 text')
  }

  let result: RuleSetConversionResult
  try {
    result = convertRuleSetContent(source, target, content)
  } catch {
    throw new RuleSetConversionError('invalid_content', 'Rule set cannot be converted without changing its meaning')
  }
  await options.kv?.put(cacheKey, JSON.stringify(result), {
    expirationTtl: Math.min(Math.max(source.updateInterval * 3600, 300), 86400),
  })
  return result
}

export async function preflightRuleSetConversions(
  data: ExportData,
  format: ExportFormat,
  options: { fetcher?: typeof fetch; kv?: KVNamespace; timeoutMs?: number; policy?: RuleSetConversionPolicy; concurrency?: number } = {}
): Promise<{
  warnings: CompatibilityWarning[]
  blockingWarnings: CompatibilityWarning[]
  blockingWarning: CompatibilityWarning | null
}> {
  const conversions = data.remoteSets
    .filter((item) => item.enabled)
    .flatMap((ruleSet) => {
      const conversion = resolveRuleSetConversionSource(ruleSet, format)
      return conversion ? [{ ruleSet, conversion }] : []
    })
  const inFlightBySource = new Map<string, Promise<RuleSetConversionResult>>()
  const outcomes = await mapWithConcurrency(
    conversions,
    options.concurrency ?? 4,
    async ({ ruleSet, conversion }) => {
      try {
        const sourceKey = `${conversion.source.url}|${conversion.source.format}|${conversion.source.behavior}|${conversion.target}`
        let conversionRequest = inFlightBySource.get(sourceKey)
        if (!conversionRequest) {
          conversionRequest = getConvertedRemoteRuleSet(conversion.source, conversion.target, options)
          inFlightBySource.set(sourceKey, conversionRequest)
        }
        const converted = await conversionRequest
        return { ruleSet, conversion, converted, error: false as const }
      } catch (error) {
        const errorCode: RuleSetConversionFailureCode = error instanceof RuleSetConversionError
          ? error.code
          : 'unexpected'
        return {
          ruleSet,
          conversion,
          error: true as const,
          errorCode,
        }
      }
    }
  )
  const warnings: CompatibilityWarning[] = []
  const blockingWarnings: CompatibilityWarning[] = []
  for (const outcome of outcomes) {
    if (!outcome.error) {
      if (outcome.converted.skippedRuleCount > 0) {
        const skippedTypes = formatSkippedRuleTypes(outcome.converted.skippedRuleTypes)
        const warning: CompatibilityWarning = {
          code: 'remote-rule-set-conversion-partial',
          client: format,
          level: options.policy === 'strict' ? 'unsupported' : 'partial',
          message: options.policy === 'strict'
            ? `远程规则集 "${outcome.ruleSet.name}" 有 ${outcome.converted.skippedRuleCount} 条规则无法完整转换${skippedTypes ? `（${skippedTypes}）` : ''}；严格完整模式已阻止导出`
            : `远程规则集 "${outcome.ruleSet.name}" 已转换 ${outcome.converted.convertedRuleCount} 条规则，另有 ${outcome.converted.skippedRuleCount} 条因无法保持语义而跳过${skippedTypes ? `（${skippedTypes}）` : ''}`,
          messageEn: options.policy === 'strict'
            ? `Remote rule set "${outcome.ruleSet.name}" has ${outcome.converted.skippedRuleCount} rules that cannot be converted completely${skippedTypes ? ` (${skippedTypes})` : ''}; strict completeness mode blocked the export.`
            : `Remote rule set "${outcome.ruleSet.name}" converted ${outcome.converted.convertedRuleCount} rules and skipped ${outcome.converted.skippedRuleCount} rules that could not be represented without changing semantics${skippedTypes ? ` (${skippedTypes})` : ''}.`,
          remediation: {
            target: 'remote-rule-sets',
            id: outcome.ruleSet.id,
            sourceOverrideTarget: outcome.conversion.target,
          },
          transformation: {
            resource: 'remote-rule-set',
            action: options.policy === 'strict' ? 'block' : 'degrade',
            source: `${outcome.ruleSet.name} (${outcome.conversion.source.format})`,
            target: `${outcome.ruleSet.name} (${outcome.conversion.target})`,
            convertedCount: outcome.converted.convertedRuleCount,
            skippedCount: outcome.converted.skippedRuleCount,
            reason: 'unsupported-directives',
          },
        }
        warnings.push(warning)
        if (options.policy === 'strict') blockingWarnings.push(warning)
      } else {
        warnings.push({
          code: 'remote-rule-set-converted',
          client: format,
          level: 'convert',
          message: `远程规则集 "${outcome.ruleSet.name}" 已安全转换 ${outcome.converted.convertedRuleCount} 条规则为 ${outcome.conversion.target} 格式`,
          messageEn: `Remote rule set "${outcome.ruleSet.name}" safely converted ${outcome.converted.convertedRuleCount} rules to ${outcome.conversion.target}.`,
          transformation: {
            resource: 'remote-rule-set',
            action: 'convert',
            source: `${outcome.ruleSet.name} (${outcome.conversion.source.format})`,
            target: `${outcome.ruleSet.name} (${outcome.conversion.target})`,
            convertedCount: outcome.converted.convertedRuleCount,
            skippedCount: 0,
            reason: 'target-rule-set-format',
          },
        })
      }
      continue
    }
    const failure = describeRuleSetConversionFailure(
      outcome.errorCode,
      outcome.ruleSet.name,
      outcome.conversion.target,
    )
    const warning: CompatibilityWarning = {
      code: 'remote-rule-set-conversion-failed',
      client: format,
      level: 'unsupported',
      message: failure.message,
      messageEn: failure.messageEn,
      remediation: {
        target: 'remote-rule-sets',
        id: outcome.ruleSet.id,
        sourceOverrideTarget: outcome.conversion.target,
      },
      transformation: {
        resource: 'remote-rule-set',
        action: 'block',
        source: `${outcome.ruleSet.name} (${outcome.conversion.source.format})`,
        target: `${outcome.ruleSet.name} (${outcome.conversion.target})`,
        reason: failure.reason,
      },
    }
    warnings.push(warning)
    blockingWarnings.push(warning)
  }
  return {
    warnings,
    blockingWarnings,
    blockingWarning: blockingWarnings[0] ?? null,
  }
}

function describeRuleSetConversionFailure(
  code: RuleSetConversionFailureCode,
  name: string,
  target: ConvertibleRuleSetTarget,
): { message: string; messageEn: string; reason: string } {
  if (code === 'download_failed') {
    return {
      message: `远程规则集 "${name}" 在转换预检时下载失败；请检查来源地址和网络状态，或为 ${target} 配置原生规则集`,
      messageEn: `Remote rule set "${name}" could not be downloaded during conversion preflight. Check the source URL and network, or configure a native ${target} rule set.`,
      reason: 'source-download-failed',
    }
  }
  if (code === 'too_large') {
    return {
      message: `远程规则集 "${name}" 超过 4 MiB 安全转换上限；请精简来源，或为 ${target} 配置原生规则集`,
      messageEn: `Remote rule set "${name}" exceeds the 4 MiB safe-conversion limit. Reduce the source or configure a native ${target} rule set.`,
      reason: 'source-too-large',
    }
  }
  if (code === 'invalid_content') {
    return {
      message: `远程规则集 "${name}" 的内容无法安全转换为 ${target}；请修复来源内容或改用目标客户端原生规则集`,
      messageEn: `Remote rule set "${name}" content cannot be converted safely to ${target}. Repair the source content or use a native rule set for the target client.`,
      reason: 'source-invalid-content',
    }
  }
  return {
    message: `远程规则集 "${name}" 无法安全转换为 ${target}；请重试或改用目标客户端原生规则集`,
    messageEn: `Remote rule set "${name}" cannot be converted safely to ${target}. Retry or use a native rule set for the target client.`,
    reason: 'conversion-unexpected-failure',
  }
}

export function convertRuleSetContent(
  source: Pick<RemoteRuleSet, 'format' | 'behavior'>,
  target: ConvertibleRuleSetTarget,
  content: string
): RuleSetConversionResult {
  const parsed = source.format === 'singbox'
    ? parseSingboxSource(content)
    : source.format === 'egern'
      ? parseEgernSource(content)
      : parseTextSource(content, source.behavior)
  if (parsed.rules.length === 0) throw new Error('No safely convertible rules were found')

  if (target === 'singbox') {
    const skippedRuleTypes = { ...parsed.skippedRuleTypes }
    const skippedRuleExamples = cloneExamples(parsed.skippedRuleExamples)
    const convertedRuleExamples: RemoteRuleSetConversionMapping[] = []
    let convertedRuleExamplesTruncated = false
    const rules = parsed.rules.flatMap((rule) => {
      if (rule.noResolve) {
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
    const convertedRuleExamples: RemoteRuleSetConversionMapping[] = []
    let convertedRuleExamplesTruncated = false
    const lines = parsed.rules.flatMap((rule) => {
      const converted = ruleToTextClient(rule, target)
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
  const convertedRuleExamples: RemoteRuleSetConversionMapping[] = []
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
  const convertedRuleExamples: RemoteRuleSetConversionMapping[] = []
  let convertedRuleExamplesTruncated = false
  let convertedRuleCount = 0
  for (const rule of parsed.rules) {
    const resolution = rule.type === 'NETWORK' || rule.type === 'PROTOCOL'
      ? resolveRuleForExport(rule.type, rule.payload, 'egern')
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

function parseTextSource(content: string, behavior: RemoteRuleSet['behavior']): ParsedRuleSet {
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

function normalizeTextRule(value: string, behavior: RemoteRuleSet['behavior']): NormalizedRule | null {
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
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
  for (const item of document.rules) {
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
  const populated = mappings.filter(([key]) => Array.isArray(rule[key]) && (rule[key] as unknown[]).length > 0)
  const knownKeys = new Set(mappings.map(([key]) => key))
  const unknownKeys = Object.entries(rule)
    .filter(([key, item]) => key !== 'type' && !knownKeys.has(key) && isPopulatedCondition(item))
    .map(([key]) => key)
  // A sing-box rule combines condition families with AND; flattening more than one would broaden it.
  if (populated.length + unknownKeys.length !== 1) return skippedSingboxRule('COMPOUND', example)
  if (unknownKeys.length === 1) return skippedSingboxRule(formatSingboxRuleType(unknownKeys[0]!), example)
  const [key, type] = populated[0]!
  const rules: NormalizedRule[] = []
  const skippedRuleTypes: Record<string, number> = {}
  const skippedRuleExamples: Record<string, string[]> = {}
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
    const parsedPort = portKind ? parseRulePortPayload(rawPayload) : null
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
  return { rules, skippedRuleTypes, skippedRuleExamples }
}

function ruleToSingboxSource(rule: NormalizedRule): Record<string, unknown> | null {
  if (rule.type === 'NETWORK' || rule.type === 'PROTOCOL') {
    const resolution = resolveRuleForExport(rule.type, rule.payload, 'singbox')
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
    const parsed = parseRulePortPayload(rule.payload)
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
    const resolution = resolveRuleForExport(rule.type, rule.payload, target)
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
  return `${targetType},${rule.payload}${rule.noResolve ? ',no-resolve' : ''}`
}

function ruleToMihomoPayload(rule: NormalizedRule, behavior: RemoteRuleSet['behavior']): string | null {
  if (behavior === 'domain') {
    if (rule.type === 'DOMAIN-SUFFIX') return `+.${rule.payload}`
    return rule.type === 'DOMAIN' ? rule.payload : null
  }
  if (behavior === 'ipcidr') {
    return rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6' ? rule.payload : null
  }
  if (rule.type === 'NETWORK' || rule.type === 'PROTOCOL') {
    const resolution = resolveRuleForExport(rule.type, rule.payload, 'mihomo')
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

function skippedTextRuleReason(value: string, behavior: RemoteRuleSet['behavior']): string {
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
  return parseRulePortPayload(value) !== null
}

function normalizePortPayload(value: string): string | null {
  const parsed = parseRulePortPayload(value)
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
  examples: RemoteRuleSetConversionMapping[],
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

function resolveConversionIssueReason(type: string): RemoteRuleSetConversionIssue['reason'] {
  if (type === 'COMPOUND') return 'compound-condition'
  if (type.startsWith('INVALID')) return 'invalid-rule'
  if (type.endsWith('-NO-RESOLVE') || type.includes('-OPTION-')) return 'unsupported-option'
  return 'unsupported-directive'
}

function resolveConversionIssueResolution(type: string): RemoteRuleSetConversionIssue['resolution'] {
  if (type.startsWith('INVALID')) return 'repair-source-rule'
  if (type.endsWith('-NO-RESOLVE') || type.includes('-OPTION-')) return 'remove-unsupported-option'
  return 'use-native-source'
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

function parseCachedConversionResult(value: string): RuleSetConversionResult | null {
  try {
    const parsed = JSON.parse(value) as Partial<RuleSetConversionResult>
    if (
      typeof parsed.content !== 'string'
      || parsed.content.length === 0
      || typeof parsed.contentType !== 'string'
      || !isNonNegativeInteger(parsed.convertedRuleCount)
      || parsed.convertedRuleCount === 0
      || !isNonNegativeInteger(parsed.skippedRuleCount)
    ) return null
    const skippedRuleTypes = normalizeCachedCountRecord(parsed.skippedRuleTypes)
    const skippedRuleExamples = normalizeCachedExamples(parsed.skippedRuleExamples)
    const convertedRuleExamples = Array.isArray(parsed.convertedRuleExamples)
      ? parsed.convertedRuleExamples.filter((item): item is RemoteRuleSetConversionMapping =>
        Boolean(item)
        && typeof item === 'object'
        && typeof item.source === 'string'
        && typeof item.target === 'string')
        .slice(0, MAX_CONVERTED_EXAMPLES)
        .map(item => ({
          source: formatDiagnosticValue(item.source),
          target: formatDiagnosticValue(item.target),
        }))
      : []
    return {
      content: parsed.content,
      contentType: parsed.contentType,
      convertedRuleCount: parsed.convertedRuleCount,
      skippedRuleCount: parsed.skippedRuleCount,
      skippedRuleTypes,
      skippedRuleExamples,
      convertedRuleExamples,
      convertedRuleExamplesTruncated: parsed.convertedRuleExamplesTruncated === true,
    }
  } catch {
    return null
  }
}

function normalizeCachedCountRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => Boolean(key) && isNonNegativeInteger(count) && count > 0)
      .map(([key, count]) => [key, count as number])
  )
}

function normalizeCachedExamples(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string[]> = {}
  let total = 0
  for (const [key, examples] of Object.entries(value)) {
    if (!key || !Array.isArray(examples) || total >= MAX_SKIPPED_EXAMPLES_TOTAL) continue
    const normalized = examples
      .filter((item): item is string => typeof item === 'string')
      .slice(0, Math.min(MAX_SKIPPED_EXAMPLES_PER_TYPE, MAX_SKIPPED_EXAMPLES_TOTAL - total))
      .map(formatDiagnosticValue)
    if (normalized.length > 0) {
      result[key] = normalized
      total += normalized.length
    }
  }
  return result
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function formatSkippedRuleTypes(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([type, count]) => `${type} × ${count}`)
    .join(', ')
}

async function readResponseBytesLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
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
        throw new RuleSetConversionError('too_large', 'Rule set is too large to convert')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
