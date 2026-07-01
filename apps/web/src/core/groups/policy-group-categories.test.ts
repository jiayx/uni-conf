import { describe, expect, it } from 'vitest'
import {
  isBuiltinBusinessRoutingGroup,
  isCustomBusinessRoutingGroup,
  isFoundationPolicyGroup,
  isNodeOutletGroup,
  isRuleTargetFoundationGroup,
  isVisibleBusinessRoutingGroup,
} from './policy-group-categories'
import type { ProxyGroup } from '@uni-conf/types'

describe('policy group category helpers', () => {
  it('keeps PROXY, DIRECT, REJECT as fixed rule-target foundations', () => {
    expect(isRuleTargetFoundationGroup(group('builtin-proxy', 'PROXY'))).toBe(true)
    expect(isRuleTargetFoundationGroup(group('builtin-direct', 'DIRECT', { type: 'direct' }))).toBe(true)
    expect(isRuleTargetFoundationGroup(group('builtin-reject', 'REJECT', { type: 'reject' }))).toBe(true)
    expect(isFoundationPolicyGroup(group('builtin-auto-select', '自动选择', { type: 'url-test' }))).toBe(true)
  })

  it('separates business groups from foundation targets and node outlets', () => {
    expect(isBuiltinBusinessRoutingGroup(group('builtin-ai', 'AI'))).toBe(true)
    expect(isBuiltinBusinessRoutingGroup(group('builtin-proxy', 'PROXY'))).toBe(false)
    expect(isBuiltinBusinessRoutingGroup(group('builtin-direct', 'DIRECT', { type: 'direct' }))).toBe(false)
    expect(isBuiltinBusinessRoutingGroup(group('builtin-auto-select', '自动选择', { type: 'url-test' }))).toBe(false)
    expect(isNodeOutletGroup(group('us-auto', 'US Auto', { isBuiltin: false, collectionIds: ['collection-us'] }))).toBe(true)
  })

  it('shows enabled built-in business groups and custom business groups only', () => {
    expect(isVisibleBusinessRoutingGroup(group('builtin-ai', 'AI'))).toBe(true)
    expect(isVisibleBusinessRoutingGroup(group('builtin-ai', 'AI', { enabled: false }))).toBe(false)
    expect(isVisibleBusinessRoutingGroup(group('custom-downloads', 'Downloads', { isBuiltin: false }))).toBe(true)
    expect(isCustomBusinessRoutingGroup(group('custom-downloads', 'Downloads', { isBuiltin: false }))).toBe(true)
    expect(isVisibleBusinessRoutingGroup(group('builtin-reject', 'REJECT', { type: 'reject' }))).toBe(false)
  })
})

function group(id: string, name: string, overrides: Partial<ProxyGroup> = {}): ProxyGroup {
  return {
    id,
    name,
    type: 'select',
    collectionIds: [],
    groupIds: [],
    builtins: [],
    enabled: true,
    order: 0,
    isBuiltin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
