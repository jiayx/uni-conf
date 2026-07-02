import { describe, expect, it } from 'vitest'
import { isSystemDisabledRemoteRuleSet, visibleRemoteRuleSetNotes } from './managed-notes'

describe('managed remote rule set notes', () => {
  it('detects system-disabled managed rule sets', () => {
    expect(isSystemDisabledRemoteRuleSet('QuixoticHeart/rule-set:crypto\n[uni-conf:auto-disabled:missing-target]')).toBe(true)
    expect(isSystemDisabledRemoteRuleSet('QuixoticHeart/rule-set:ai')).toBe(false)
    expect(isSystemDisabledRemoteRuleSet(null)).toBe(false)
  })

  it('hides internal system markers from visible notes', () => {
    expect(visibleRemoteRuleSetNotes('QuixoticHeart/rule-set:crypto\n[uni-conf:auto-disabled:missing-target]')).toBe('QuixoticHeart/rule-set:crypto')
    expect(visibleRemoteRuleSetNotes('[uni-conf:auto-disabled:missing-target]')).toBe('')
    expect(visibleRemoteRuleSetNotes('')).toBe('')
  })
})

