import {
  getCompatibleRuleSetFormats as getSharedCompatibleRuleSetFormats,
  isRuleSetFormatCompatible as isSharedRuleSetFormatCompatible,
  resolveQuixoticRuleSetForExport,
  supportsQuixoticRuleSetExport,
} from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet, RuleSetFormat } from '@uni-conf/types'

export function getCompatibleRuleSetFormats(format: ExportFormat): RuleSetFormat[] {
  return getSharedCompatibleRuleSetFormats(format).filter(isRuleSetFormat) as RuleSetFormat[]
}

export function isRuleSetFormatCompatible(exportFormat: ExportFormat, ruleSetFormat: RuleSetFormat): boolean {
  return isSharedRuleSetFormatCompatible(exportFormat, ruleSetFormat)
}

export function isRemoteRuleSetCompatible(exportFormat: ExportFormat, ruleSet: Pick<RemoteRuleSet, 'format' | 'presetSource' | 'presetId'>): boolean {
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    return supportsQuixoticRuleSetExport(exportFormat)
  }
  return isRuleSetFormatCompatible(exportFormat, ruleSet.format)
}

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSet,
  exportFormat: ExportFormat
): { url: string; format: RuleSetFormat } | null {
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return null
    const resolved = resolveQuixoticRuleSetForExport(ruleSet.presetId, exportFormat)
    return { url: resolved.url, format: resolved.format as RuleSetFormat }
  }

  return { url: ruleSet.url, format: ruleSet.format }
}

export function describeCompatibleRuleSetFormats(format: ExportFormat): string {
  const formats = getCompatibleRuleSetFormats(format)
  return formats.length > 0 ? formats.join(', ') : '不支持远程规则集'
}

function isRuleSetFormat(value: string): value is RuleSetFormat {
  return ['mihomo', 'clash', 'singbox', 'surge', 'loon', 'shadowrocket', 'quantumultx', 'egern', 'stash', 'text'].includes(value)
}
