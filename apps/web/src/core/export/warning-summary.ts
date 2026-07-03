import type { CompatibilityWarning } from '@uni-conf/types'

export interface ExportWarningSummary {
  unsupported: number
  partial: number
  convert: number
  total: number
  canUseConfig: boolean
}

export function summarizeExportWarnings(warnings: CompatibilityWarning[]): ExportWarningSummary {
  const unsupported = warnings.filter(warning => warning.level === 'unsupported').length
  const partial = warnings.filter(warning => warning.level === 'partial').length
  const convert = warnings.filter(warning => warning.level === 'convert').length

  return {
    unsupported,
    partial,
    convert,
    total: warnings.length,
    canUseConfig: unsupported === 0,
  }
}

export function exportWarningSummaryText(
  summary: ExportWarningSummary,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (summary.total === 0) return t('export.validation_ready')
  if (summary.unsupported > 0) {
    return t('export.validation_blocked_summary', {
      unsupported: summary.unsupported,
      partial: summary.partial,
      convert: summary.convert,
    })
  }
  return t('export.validation_warning_summary', {
    partial: summary.partial,
    convert: summary.convert,
  })
}
