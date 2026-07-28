import {
  getRuleSetConversionTargetFormat,
  isRuleSetFormatCompatible,
  resolveRemoteRuleSetForExport as resolveSharedRemoteRuleSetForExport,
} from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet } from '@uni-conf/types'

type Row = Record<string, unknown>

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSet,
  exportFormat: ExportFormat,
  conversionBaseUrl?: string
): { url: string; format: RemoteRuleSet['format']; converted?: boolean } | null {
  const resolved = resolveSharedRemoteRuleSetForExport(ruleSet, exportFormat)
  if (resolved && isRuleSetFormatCompatible(exportFormat, resolved.format)) {
    return { url: resolved.url, format: resolved.format as RemoteRuleSet['format'] }
  }
  const target = resolved ? getRuleSetConversionTargetFormat(resolved.format, exportFormat) : null
  if (conversionBaseUrl && target) {
    return {
      url: buildConversionUrl(conversionBaseUrl, ruleSet.id, target, exportFormat),
      format: target,
      converted: true,
    }
  }
  return resolved ? { url: resolved.url, format: resolved.format as RemoteRuleSet['format'] } : null
}

export function resolveRemoteRuleSetRowForExport(
  ruleSet: Row,
  exportFormat: ExportFormat,
  conversionBaseUrl?: string
): { url: string; format: string; converted?: boolean } | null {
  const resolved = resolveSharedRemoteRuleSetForExport({
    url: String(ruleSet['url'] ?? ''),
    format: String(ruleSet['format'] ?? ''),
    presetSource: nullableString(ruleSet['preset_source']),
    presetId: nullableString(ruleSet['preset_id']),
    sourceOverrides: parseSourceOverrides(ruleSet['source_overrides']),
  }, exportFormat)
  if (resolved && isRuleSetFormatCompatible(exportFormat, resolved.format)) return resolved
  const target = resolved ? getRuleSetConversionTargetFormat(resolved.format, exportFormat) : null
  if (conversionBaseUrl && target) {
    return {
      url: buildConversionUrl(
        conversionBaseUrl,
        String(ruleSet['id'] ?? ''),
        target,
        exportFormat,
      ),
      format: target,
      converted: true,
    }
  }
  return resolved
}

function conversionTargetFilename(target: NonNullable<ReturnType<typeof getRuleSetConversionTargetFormat>>): string {
  if (target === 'singbox') return 'singbox.json'
  if (target === 'mihomo') return 'mihomo.yaml'
  if (target === 'egern') return 'egern.yaml'
  return `${target}.list`
}

function buildConversionUrl(
  conversionBaseUrl: string,
  ruleSetId: string,
  target: NonNullable<ReturnType<typeof getRuleSetConversionTargetFormat>>,
  exportFormat: ExportFormat,
): string {
  const url = `${conversionBaseUrl}/${encodeURIComponent(ruleSetId)}/${conversionTargetFilename(target)}`
  // Clash and Stash share Mihomo's converted YAML container, but may select
  // different target-native source overrides. Preserve the actual client
  // identity so the token endpoint resolves the same source as preflight.
  return target === 'mihomo' && exportFormat !== 'mihomo'
    ? `${url}?for=${encodeURIComponent(exportFormat)}`
    : url
}

function parseSourceOverrides(value: unknown): RemoteRuleSet['sourceOverrides'] {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as RemoteRuleSet['sourceOverrides']
      : {}
  } catch {
    return {}
  }
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '')
  return text ? text : null
}
