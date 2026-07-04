import { describe, expect, it } from 'vitest'
import {
  isValidExportFormat,
  resolveExportConfigName,
  resolveExportConfigUpdateName,
  validateExportConfigSelection,
} from './export'

describe('export route helpers', () => {
  it('derives export config names from the target format', () => {
    expect(resolveExportConfigName(undefined, 'mihomo')).toBe('默认 Mihomo / Clash / OpenClash 配置')
    expect(resolveExportConfigName('', 'singbox')).toBe('默认 sing-box 配置')
  })

  it('trims user-provided export config names', () => {
    expect(resolveExportConfigName('  Router Config  ', 'mihomo')).toBe('Router Config')
  })

  it('normalizes update names only when the client submits a name field', () => {
    expect(resolveExportConfigUpdateName(undefined, 'singbox', 'mihomo')).toBeUndefined()
    expect(resolveExportConfigUpdateName('', 'singbox', 'mihomo')).toBe('默认 sing-box 配置')
    expect(resolveExportConfigUpdateName('   ', undefined, 'stash')).toBe('默认 Stash 配置')
    expect(resolveExportConfigUpdateName('  Travel  ', 'mihomo', 'singbox')).toBe('Travel')
  })

  it('validates export formats from the shared subscription format list', () => {
    expect(isValidExportFormat('mihomo')).toBe(true)
    expect(isValidExportFormat('singbox')).toBe(true)
    expect(isValidExportFormat('nodes_raw')).toBe(true)
    expect(isValidExportFormat('sing-box')).toBe(false)
    expect(isValidExportFormat('yaml')).toBe(false)
  })

  it('normalizes export config include lists', () => {
    expect(validateExportConfigSelection({
      includeCollectionIds: [' collection-1 ', 'collection-1', 'collection-2'],
      includeGroupIds: ['group-1'],
      includeRuleIds: undefined,
      includeRemoteSetIds: ['remote-1'],
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

  it('normalizes export config extra config objects', () => {
    expect(validateExportConfigSelection({
      extraConfig: { dns: { enabled: true } },
    })).toEqual({
      valid: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      extraConfig: { dns: { enabled: true } },
    })
    expect(validateExportConfigSelection({ extraConfig: null })).toEqual({
      valid: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      extraConfig: null,
    })
  })

  it('rejects malformed export config extra config values', () => {
    expect(validateExportConfigSelection({ extraConfig: ['dns'] as never })).toEqual({
      valid: false,
      error: 'extraConfig must be an object or null',
    })
    expect(validateExportConfigSelection({ extraConfig: 'dns' as never })).toEqual({
      valid: false,
      error: 'extraConfig must be an object or null',
    })
  })
})
