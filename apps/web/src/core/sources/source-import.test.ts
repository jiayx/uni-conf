import { describe, expect, it } from 'vitest'
import { MAX_SOURCE_CONTENT_BYTES } from '@uni-conf/shared'
import {
  buildImportSourcePayload,
  getImportContentByteLength,
  isImportContentValid,
  isImportContentWithinSizeLimit,
  isImportFileWithinSizeLimit,
} from './source-import'

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

  it('includes the explicit new-only node decision', () => {
    expect(buildImportSourcePayload({
      content: 'proxies: []',
      format: 'auto',
      importStructured: true,
      nodeImportMode: 'new-only',
    })).toEqual({ content: 'proxies: []', importStructured: true, nodeImportMode: 'new-only' })
  })

  it('includes only explicitly selected structured conflict decisions', () => {
    expect(buildImportSourcePayload({
      content: 'rules: []',
      format: 'mihomo',
      importStructured: true,
      structuredConflictResolutions: {
        'rule:0:DOMAIN|example.com|0': 'use-imported',
      },
    })).toEqual({
      content: 'rules: []',
      format: 'mihomo',
      importStructured: true,
      structuredConflictResolutions: {
        'rule:0:DOMAIN|example.com|0': 'use-imported',
      },
    })
  })

  it('rejects blank or whitespace-only content', () => {
    expect(isImportContentValid('')).toBe(false)
    expect(isImportContentValid('   \n  ')).toBe(false)
    expect(isImportContentValid('proxies: []')).toBe(true)
  })

  it('enforces the source limit in UTF-8 bytes for pasted content and files', () => {
    const chineseAtLimit = '你'.repeat(Math.floor(MAX_SOURCE_CONTENT_BYTES / 3))
    expect(getImportContentByteLength('你')).toBe(3)
    expect(isImportContentWithinSizeLimit('a'.repeat(MAX_SOURCE_CONTENT_BYTES))).toBe(true)
    expect(isImportContentWithinSizeLimit(`${chineseAtLimit}你`)).toBe(false)
    expect(isImportFileWithinSizeLimit(MAX_SOURCE_CONTENT_BYTES)).toBe(true)
    expect(isImportFileWithinSizeLimit(MAX_SOURCE_CONTENT_BYTES + 1)).toBe(false)
    expect(isImportFileWithinSizeLimit(Number.NaN)).toBe(false)
  })
})
