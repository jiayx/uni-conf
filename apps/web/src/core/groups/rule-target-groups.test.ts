import { describe, expect, it } from 'vitest'
import { getDefaultRuleTargetGroupId, isRuleTargetGroup } from './rule-target-groups'

describe('rule target group helpers', () => {
  it('allows business and foundation rule targets', () => {
    expect(isRuleTargetGroup({ id: 'builtin-proxy', collectionIds: [] })).toBe(true)
    expect(isRuleTargetGroup({ id: 'builtin-direct', collectionIds: [] })).toBe(true)
    expect(isRuleTargetGroup({ id: 'builtin-reject', collectionIds: [] })).toBe(true)
    expect(isRuleTargetGroup({ id: 'builtin-ai', collectionIds: [] })).toBe(true)
  })

  it('excludes global node outlets and node-backed groups', () => {
    expect(isRuleTargetGroup({ id: 'builtin-all-nodes', collectionIds: [] })).toBe(false)
    expect(isRuleTargetGroup({ id: 'builtin-node-select', collectionIds: [] })).toBe(false)
    expect(isRuleTargetGroup({ id: 'builtin-auto-select', collectionIds: [] })).toBe(false)
    expect(isRuleTargetGroup({ id: 'builtin-fallback-select', collectionIds: [] })).toBe(false)
    expect(isRuleTargetGroup({ id: 'us-auto', collectionIds: ['collection-us'] })).toBe(false)
  })

  it('resolves the default rule target from shared foundation ids', () => {
    expect(getDefaultRuleTargetGroupId([
      { id: 'builtin-ai', name: 'AI' },
      { id: 'builtin-proxy', name: 'PROXY' },
    ])).toBe('builtin-proxy')
    expect(getDefaultRuleTargetGroupId([
      { id: 'custom-proxy', name: 'PROXY' },
      { id: 'builtin-ai', name: 'AI' },
    ])).toBe('custom-proxy')
    expect(getDefaultRuleTargetGroupId([])).toBe('builtin-proxy')
  })
})
