import { resolveQuixoticRuleSetForExport, supportsQuixoticRuleSetExport } from '@uni-conf/shared'
import type { RemoteRuleSet } from '@uni-conf/types'

type Row = Record<string, unknown>

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSet,
  exportFormat: string
): { url: string; format: RemoteRuleSet['format'] } | null {
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return null
    const resolved = resolveQuixoticRuleSetForExport(ruleSet.presetId, exportFormat)
    return { url: resolved.url, format: resolved.format as RemoteRuleSet['format'] }
  }

  return { url: ruleSet.url, format: ruleSet.format }
}

export function resolveRemoteRuleSetRowForExport(
  ruleSet: Row,
  exportFormat: string
): { url: string; format: string } | null {
  const presetSource = String(ruleSet['preset_source'] ?? '')
  const presetId = String(ruleSet['preset_id'] ?? '')
  if (presetSource === 'quixotic' && presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return null
    return resolveQuixoticRuleSetForExport(presetId, exportFormat)
  }

  return {
    url: String(ruleSet['url'] ?? ''),
    format: String(ruleSet['format'] ?? ''),
  }
}
