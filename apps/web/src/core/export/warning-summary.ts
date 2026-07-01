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

export function exportWarningSummaryText(summary: ExportWarningSummary): string {
  if (summary.total === 0) return '配置可用'
  if (summary.unsupported > 0) {
    return `需要处理 ${summary.unsupported} 个阻塞问题，另有 ${summary.partial} 个自动调整项、${summary.convert} 个格式转换提示`
  }
  return `配置可用，包含 ${summary.partial} 个自动调整项、${summary.convert} 个格式转换提示`
}
