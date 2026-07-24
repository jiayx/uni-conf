import { describe, expect, it } from 'vitest'
import { compatibilityWarningMessage } from './compatibility-warning'

const warning = {
  client: 'mihomo' as const,
  level: 'partial' as const,
  message: '中文提示',
  messageEn: 'English notice',
}

describe('compatibilityWarningMessage', () => {
  it('uses Chinese for Chinese locales', () => {
    expect(compatibilityWarningMessage(warning, 'zh-CN')).toBe('中文提示')
  })

  it('uses English as the fallback language', () => {
    expect(compatibilityWarningMessage(warning, 'en-US')).toBe('English notice')
    expect(compatibilityWarningMessage(warning)).toBe('English notice')
  })
})
