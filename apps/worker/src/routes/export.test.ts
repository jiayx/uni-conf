import { describe, expect, it } from 'vitest'
import { resolveExportConfigName } from './export'

describe('export route helpers', () => {
  it('derives export config names from the target format', () => {
    expect(resolveExportConfigName(undefined, 'mihomo')).toBe('默认 Mihomo 配置')
    expect(resolveExportConfigName('', 'singbox')).toBe('默认 sing-box 配置')
    expect(resolveExportConfigName('   ', 'clash')).toBe('默认 Clash / OpenClash 配置')
  })

  it('trims user-provided export config names', () => {
    expect(resolveExportConfigName('  Router Config  ', 'mihomo')).toBe('Router Config')
  })
})
