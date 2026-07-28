import type {
  CompatibilityWarning,
  ExportFormat,
  RemoteRuleSet,
  RuleSetConversionMapping,
  RuleSetConversionPolicy,
  RuleSetFormat,
} from '@uni-conf/types'
import {
  convertRuleSetContent,
  type ConvertibleRuleSetTarget,
  type RuleSetConversionResult,
} from '@uni-conf/rule-set'
import {
  getRuleSetConversionTargetFormat,
  isRuleSetFormatCompatible,
  resolveRemoteRuleSetForExport,
} from '@uni-conf/shared'
import type { ExportData } from '../export-data'
import { mapWithConcurrency } from './async-pool'
import { buildPrivateCacheKey } from './private-cache-key'
import { safeRemoteFetch } from './safe-remote-fetch'

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
    11,
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

  let content: Uint8Array
  try {
    content = await readResponseBytesLimited(response, MAX_CONVERTIBLE_RULE_SET_BYTES)
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
  if (options.policy !== 'strict') {
    return { warnings: [], blockingWarnings: [], blockingWarning: null }
  }
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
      || !isCountRecord(parsed.skippedRuleTypes)
      || !isExamplesRecord(parsed.skippedRuleExamples)
      || !Array.isArray(parsed.convertedRuleExamples)
      || !parsed.convertedRuleExamples.every(isConversionMapping)
      || typeof parsed.convertedRuleExamplesTruncated !== 'boolean'
    ) return null
    return parsed as RuleSetConversionResult
  } catch {
    return null
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.values(value).every(isNonNegativeInteger)
}

function isExamplesRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value)
    && Object.values(value).every(item => Array.isArray(item) && item.every(value => typeof value === 'string'))
}

function isConversionMapping(value: unknown): value is RuleSetConversionMapping {
  return isRecord(value)
    && typeof value.source === 'string'
    && typeof value.target === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
