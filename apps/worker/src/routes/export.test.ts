import { describe, expect, it } from 'vitest'
import {
  resolveExportConfigName,
  resolveExportConfigUpdateName,
  validateExportConfigSelection,
} from './export'

describe('export route helpers', () => {
  it('derives export config names from the target format', () => {
    expect(resolveExportConfigName(undefined, 'mihomo')).toBe('Mihomo / Clash.Meta 配置')
    expect(resolveExportConfigName('', 'singbox')).toBe('sing-box 配置')
  })

  it('trims user-provided export config names', () => {
    expect(resolveExportConfigName('  Router Config  ', 'mihomo')).toBe('Router Config')
  })

  it('normalizes update names only when the client submits a name field', () => {
    expect(resolveExportConfigUpdateName(undefined, 'singbox', 'mihomo')).toBeUndefined()
    expect(resolveExportConfigUpdateName('', 'singbox', 'mihomo')).toBe('sing-box 配置')
    expect(resolveExportConfigUpdateName('   ', undefined, 'stash')).toBe('Stash 配置')
    expect(resolveExportConfigUpdateName('  Travel  ', 'mihomo', 'singbox')).toBe('Travel')
  })

  it('normalizes export config include lists', () => {
    expect(validateExportConfigSelection({
      includeCollectionIds: [' collection-1 ', 'collection-1', 'collection-2'],
      includeGroupIds: ['group-1'],
      includeRuleIds: undefined,
      includeRemoteSetIds: ['remote-1'],
      enabled: false,
    })).toEqual({
      valid: true,
      includeCollectionIds: ['collection-1', 'collection-2'],
      includeGroupIds: ['group-1'],
      includeRuleIds: [],
      includeRemoteSetIds: ['remote-1'],
    })
  })

  it('rejects malformed export config include lists', () => {
    expect(validateExportConfigSelection({ includeCollectionIds: 'collection-1' as never })).toEqual({
      valid: false,
      error: 'includeCollectionIds must be an array',
    })
    expect(validateExportConfigSelection({ includeGroupIds: ['group-1', ''] })).toEqual({
      valid: false,
      error: 'includeGroupIds must only contain non-empty strings',
    })
  })

  it('accepts explicit conversion policies and null inheritance', () => {
    expect(validateExportConfigSelection({ ruleSetConversionPolicy: 'strict' })).toMatchObject({
      valid: true,
      ruleSetConversionPolicy: 'strict',
    })
    expect(validateExportConfigSelection({ ruleSetConversionPolicy: 'compatible' })).toMatchObject({
      valid: true,
      ruleSetConversionPolicy: 'compatible',
    })
    expect(validateExportConfigSelection({ ruleSetConversionPolicy: null })).toMatchObject({
      valid: true,
      ruleSetConversionPolicy: null,
    })
  })

  it('rejects unknown conversion policies', () => {
    expect(validateExportConfigSelection({
      ruleSetConversionPolicy: 'best-effort' as never,
    })).toEqual({
      valid: false,
      error: 'ruleSetConversionPolicy must be compatible, strict, or null',
    })
  })
})
