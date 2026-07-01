import { describe, expect, it } from 'vitest'
import { exportWarningSummaryText, summarizeExportWarnings } from './warning-summary'
import type { CompatibilityWarning } from '@uni-conf/types'

describe('export warning summary', () => {
  it('marks configs usable when no unsupported warning exists', () => {
    const summary = summarizeExportWarnings([
      warning('partial'),
      warning('convert'),
    ])

    expect(summary).toEqual({
      unsupported: 0,
      partial: 1,
      convert: 1,
      total: 2,
      canUseConfig: true,
    })
    expect(exportWarningSummaryText(summary)).toBe('配置可用，包含 1 个自动调整项、1 个格式转换提示')
  })

  it('marks unsupported warnings as blocking', () => {
    const summary = summarizeExportWarnings([
      warning('unsupported'),
      warning('partial'),
    ])

    expect(summary.canUseConfig).toBe(false)
    expect(exportWarningSummaryText(summary)).toBe('需要处理 1 个阻塞问题，另有 1 个自动调整项、0 个格式转换提示')
  })

  it('uses a compact ready summary when there are no warnings', () => {
    expect(exportWarningSummaryText(summarizeExportWarnings([]))).toBe('配置可用')
  })
})

function warning(level: CompatibilityWarning['level']): CompatibilityWarning {
  return {
    client: 'mihomo',
    level,
    message: level,
    messageEn: level,
  }
}
