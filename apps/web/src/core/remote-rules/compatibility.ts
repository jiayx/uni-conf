import type { ExportFormat, RuleSetFormat } from '@uni-conf/types'

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

export function describeCompatibleRuleSetFormats(format: ExportFormat): string {
  const formats = getCompatibleRuleSetFormats(format)
  return formats.length > 0 ? formats.join(', ') : '不支持远程规则集'
}
