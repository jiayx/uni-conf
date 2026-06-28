import { describe, expect, it } from 'vitest'
import { isValidRuleType, validateRuleInput } from './rules'

describe('rules route helpers', () => {
  it('validates rule types from the shared compatibility map', () => {
    expect(isValidRuleType('DOMAIN-SUFFIX')).toBe(true)
    expect(isValidRuleType('MATCH')).toBe(true)
    expect(isValidRuleType('DOMAIN_SET')).toBe(false)
    expect(isValidRuleType('')).toBe(false)
  })

  it('requires payload except for MATCH rules', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: 'builtin-proxy',
    })).toBeNull()

    expect(validateRuleInput({
      type: 'MATCH',
      payload: '',
      targetGroupId: 'builtin-proxy',
    })).toBeNull()

    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: '',
      targetGroupId: 'builtin-proxy',
    })).toBe('payload is required unless type is MATCH')
  })

  it('allows create inputs to omit target policy group', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: ' ',
    })).toBeNull()
  })
})
