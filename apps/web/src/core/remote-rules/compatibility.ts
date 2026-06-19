import { resolveQuixoticRuleSetForExport, supportsQuixoticRuleSetExport } from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet, RuleSetFormat } from '@uni-conf/types'

const COMPATIBLE_RULE_SET_FORMATS: Partial<Record<ExportFormat, RuleSetFormat[]>> = {
  mihomo: ['mihomo', 'clash', 'stash', 'text'],
  clash: ['mihomo', 'clash', 'stash', 'text'],
  singbox: ['singbox'],
  loon: ['loon', 'surge', 'shadowrocket', 'text'],
  surge: ['surge', 'text'],
  shadowrocket: ['shadowrocket', 'surge', 'text'],
  quantumultx: ['quantumultx', 'text'],
  stash: ['stash', 'mihomo', 'clash', 'text'],
  egern: ['egern', 'text'],
}

export function getCompatibleRuleSetFormats(format: ExportFormat): RuleSetFormat[] {
  return COMPATIBLE_RULE_SET_FORMATS[format] ?? []
}

export function isRuleSetFormatCompatible(exportFormat: ExportFormat, ruleSetFormat: RuleSetFormat): boolean {
  return getCompatibleRuleSetFormats(exportFormat).includes(ruleSetFormat)
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
