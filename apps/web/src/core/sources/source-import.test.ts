import { describe, expect, it } from 'vitest'
import { buildImportSourcePayload, isImportContentValid } from './source-import'

describe('source import helpers', () => {
  it('builds the minimal payload from pasted content', () => {
    expect(buildImportSourcePayload({
      content: 'proxies: []',
      format: 'auto',
    })).toEqual({
      content: 'proxies: []',
    })
  })

  it('includes a trimmed name and an explicit non-auto format', () => {
    expect(buildImportSourcePayload({
      name: '  My Config  ',
      content: 'proxies: []',
      format: 'mihomo',
    })).toEqual({
      name: 'My Config',
      content: 'proxies: []',
      format: 'mihomo',
    })
  })

  it('omits a blank name', () => {
    expect(buildImportSourcePayload({
      name: '   ',
      content: 'proxies: []',
      format: 'auto',
    })).toEqual({
      content: 'proxies: []',
    })
  })

  it('adds structured migration only after the user confirms the preview', () => {
    expect(buildImportSourcePayload({
      content: 'proxies: []',
      format: 'auto',
      importStructured: true,
    })).toEqual({ content: 'proxies: []', importStructured: true })
  })

  it('rejects blank or whitespace-only content', () => {
    expect(isImportContentValid('')).toBe(false)
    expect(isImportContentValid('   \n  ')).toBe(false)
    expect(isImportContentValid('proxies: []')).toBe(true)
  })
})
