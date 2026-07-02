import { describe, expect, it } from 'vitest'
import { applyRename } from './node-rename'

describe('node rename', () => {
  it('standardizes country aliases once when names contain flag and code', () => {
    expect(applyRename('🇭🇰 HK Auto', {
      id: 'country',
      type: 'standardize_country',
      enabled: true,
      order: 0,
    })).toBe('香港 Auto')
  })
})
