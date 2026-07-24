import type { CompatibilityWarning, ExportDownloadReadiness } from '@uni-conf/types'

export interface ExportWarningSummary {
  unsupported: number
  partial: number
  convert: number
  total: number
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
  }
}

export function exportWarningSummaryText(
  summary: ExportWarningSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
  readiness: ExportDownloadReadiness,
): string {
  if (summary.total === 0) return t('export.validation_ready')
  if (!readiness.ready) {
    return t('export.validation_blocked_summary', {
      unsupported: readiness.blockingWarnings.length,
      partial: summary.partial,
      convert: summary.convert,
    })
  }
  return t('export.validation_warning_summary', {
    unsupported: summary.unsupported,
    partial: summary.partial,
    convert: summary.convert,
  })
}
