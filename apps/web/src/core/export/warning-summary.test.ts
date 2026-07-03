import { describe, expect, it } from 'vitest'
import { exportWarningSummaryText, summarizeExportWarnings } from './warning-summary'
import type { CompatibilityWarning } from '@uni-conf/types'

const t = createTestT({
  'export.validation_ready': '配置可用',
  'export.validation_warning_summary': '配置可用，包含 {{partial}} 个自动调整项、{{convert}} 个格式转换提示',
  'export.validation_blocked_summary': '需要处理 {{unsupported}} 个阻塞问题，另有 {{partial}} 个自动调整项、{{convert}} 个格式转换提示',
})

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
    expect(exportWarningSummaryText(summary, t)).toBe('配置可用，包含 1 个自动调整项、1 个格式转换提示')
  })

  it('marks unsupported warnings as blocking', () => {
    const summary = summarizeExportWarnings([
      warning('unsupported'),
      warning('partial'),
    ])

    expect(summary.canUseConfig).toBe(false)
    expect(exportWarningSummaryText(summary, t)).toBe('需要处理 1 个阻塞问题，另有 1 个自动调整项、0 个格式转换提示')
  })

  it('uses a compact ready summary when there are no warnings', () => {
    expect(exportWarningSummaryText(summarizeExportWarnings([]), t)).toBe('配置可用')
  })
})

function createTestT(messages: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>): string => {
    let text = messages[key] ?? key
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replaceAll(`{{${name}}}`, String(value))
    }
    return text
  }
}

function warning(level: CompatibilityWarning['level']): CompatibilityWarning {
  return {
    client: 'mihomo',
    level,
    message: level,
    messageEn: level,
  }
}
