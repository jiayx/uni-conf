import {
  getCompatibleRuleSetFormats,
  getRuleSetConversionTargetFormat,
  isRemoteRuleSetCompatible as isSharedRemoteRuleSetCompatible,
  isRuleSetFormatCompatible as isSharedRuleSetFormatCompatible,
  resolveRemoteRuleSetForExport as resolveSharedRemoteRuleSetForExport,
} from '@uni-conf/shared'
import type { ExportFormat, RemoteRuleSet } from '@uni-conf/types'

export function isRemoteRuleSetCompatible(exportFormat: ExportFormat, ruleSet: Pick<RemoteRuleSet, 'format' | 'presetSource' | 'presetId' | 'sourceOverrides'>): boolean {
  return getRemoteRuleSetCompatibilityMode(exportFormat, ruleSet) !== 'unsupported'
}

export function getRemoteRuleSetCompatibilityMode(
  exportFormat: ExportFormat,
  ruleSet: Pick<RemoteRuleSet, 'format' | 'presetSource' | 'presetId' | 'sourceOverrides'>
): 'direct' | 'converted' | 'unsupported' {
  const resolved = resolveSharedRemoteRuleSetForExport({ ...ruleSet, url: '' }, exportFormat)
  if (!resolved || !isSharedRemoteRuleSetCompatible(exportFormat, ruleSet)) return 'unsupported'
  if (isSharedRuleSetFormatCompatible(exportFormat, resolved.format)) return 'direct'
  return getRuleSetConversionTargetFormat(resolved.format, exportFormat) ? 'converted' : 'unsupported'
}

export function describeCompatibleRuleSetFormats(
  format: ExportFormat,
  t: (key: string) => string
): string {
  const formats = getCompatibleRuleSetFormats(format)
  return formats.length > 0 ? formats.join(', ') : t('remoteRuleSets.unsupported_formats')
}
