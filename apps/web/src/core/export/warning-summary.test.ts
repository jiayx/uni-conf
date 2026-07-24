import { describe, expect, it } from 'vitest'
import { exportWarningSummaryText, summarizeExportWarnings } from './warning-summary'
import type { CompatibilityWarning } from '@uni-conf/types'

const t = createTestT({
  'export.validation_ready': '配置可用',
  'export.validation_warning_summary': '配置可用，包含 {{unsupported}} 个非阻断提示、{{partial}} 个自动调整项、{{convert}} 个格式转换提示',
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
    })
    expect(exportWarningSummaryText(summary, t, { ready: true, blockingWarnings: [] })).toBe('配置可用，包含 0 个非阻断提示、1 个自动调整项、1 个格式转换提示')
  })

  it('uses authoritative readiness instead of treating every unsupported warning as blocking', () => {
    const summary = summarizeExportWarnings([
      warning('unsupported'),
      warning('partial'),
    ])

    expect(exportWarningSummaryText(summary, t, { ready: true, blockingWarnings: [] })).toBe('配置可用，包含 1 个非阻断提示、1 个自动调整项、0 个格式转换提示')
    expect(exportWarningSummaryText(summary, t, { ready: false, blockingWarnings: [warning('unsupported')] })).toBe('需要处理 1 个阻塞问题，另有 1 个自动调整项、0 个格式转换提示')
  })

  it('uses a compact ready summary when there are no warnings', () => {
    expect(exportWarningSummaryText(summarizeExportWarnings([]), t, { ready: true, blockingWarnings: [] })).toBe('配置可用')
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
