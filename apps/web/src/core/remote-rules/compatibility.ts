import {
  getCompatibleRuleSetFormats as getSharedCompatibleRuleSetFormats,
  isRemoteRuleSetCompatible as isSharedRemoteRuleSetCompatible,
  isRuleSetFormatCompatible as isSharedRuleSetFormatCompatible,
  resolveRemoteRuleSetForExport as resolveSharedRemoteRuleSetForExport,
} from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet, RuleSetFormat } from '@uni-conf/types'

export function getCompatibleRuleSetFormats(format: ExportFormat): RuleSetFormat[] {
  return getSharedCompatibleRuleSetFormats(format).filter(isRuleSetFormat) as RuleSetFormat[]
}

export function isRuleSetFormatCompatible(exportFormat: ExportFormat, ruleSetFormat: RuleSetFormat): boolean {
  return isSharedRuleSetFormatCompatible(exportFormat, ruleSetFormat)
}

export function isRemoteRuleSetCompatible(exportFormat: ExportFormat, ruleSet: Pick<RemoteRuleSet, 'format' | 'presetSource' | 'presetId'>): boolean {
  return isSharedRemoteRuleSetCompatible(exportFormat, ruleSet)
}

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSet,
  exportFormat: ExportFormat
): { url: string; format: RuleSetFormat } | null {
  const resolved = resolveSharedRemoteRuleSetForExport(ruleSet, exportFormat)
  if (!resolved || !isRuleSetFormat(resolved.format)) return null
  return resolved
}

export function describeCompatibleRuleSetFormats(format: ExportFormat): string {
  const formats = getCompatibleRuleSetFormats(format)
  return formats.length > 0 ? formats.join(', ') : '不支持远程规则集'
}

function isRuleSetFormat(value: string): value is RuleSetFormat {
  return ['mihomo', 'clash', 'singbox', 'surge', 'loon', 'shadowrocket', 'quantumultx', 'egern', 'stash', 'text'].includes(value)
}
