import { resolveRemoteRuleSetForExport as resolveSharedRemoteRuleSetForExport } from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet } from '@uni-conf/types'

type Row = Record<string, unknown>

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSet,
  exportFormat: ExportFormat
): { url: string; format: RemoteRuleSet['format'] } | null {
  const resolved = resolveSharedRemoteRuleSetForExport(ruleSet, exportFormat)
  return resolved ? { url: resolved.url, format: resolved.format as RemoteRuleSet['format'] } : null
}

export function resolveRemoteRuleSetRowForExport(
  ruleSet: Row,
  exportFormat: ExportFormat
): { url: string; format: string } | null {
  return resolveSharedRemoteRuleSetForExport({
    url: String(ruleSet['url'] ?? ''),
    format: String(ruleSet['format'] ?? ''),
    presetSource: nullableString(ruleSet['preset_source']),
    presetId: nullableString(ruleSet['preset_id']),
  }, exportFormat)
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '')
  return text ? text : null
}
