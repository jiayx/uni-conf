import { describe, expect, it } from 'vitest'
import type { DashboardStats } from '@uni-conf/types'
import { deriveDashboardAttention } from './attention-center'

const stats: DashboardStats = {
  sourceCount: 1,
  sourceRefreshFailureCount: 2,
  nodeCount: 2,
  enabledNodeCount: 2,
  collectionCount: 1,
  groupCount: 1,
  ruleCount: 1,
  exportConfigCount: 1,
  defaultExportEnabled: true,
  ruleSetHealth: {
    total: 5,
    valid: 1,
    warning: 1,
    invalid: 1,
    stale: 1,
    pending: 1,
  },
}

describe('deriveDashboardAttention', () => {
  it('reports persisted failures without turning unknown health into work', () => {
    expect(deriveDashboardAttention(stats)).toEqual([
      { id: 'source_refresh', severity: 'warning', count: 2, to: '/sources?attention=refresh' },
      { id: 'rule_source_invalid', severity: 'error', count: 1, to: '/remote-rule-sets?attention=1' },
    ])
  })

  it('reports a paused public profile', () => {
    expect(deriveDashboardAttention({
      ...stats,
      sourceRefreshFailureCount: 0,
      ruleSetHealth: undefined,
      defaultExportEnabled: false,
    })).toEqual([
      { id: 'export_paused', severity: 'error', count: 1, to: '/export' },
    ])
  })

  it('returns no items for a healthy system', () => {
    expect(deriveDashboardAttention({
      ...stats,
      sourceRefreshFailureCount: 0,
      ruleSetHealth: {
        total: 1, valid: 1, warning: 0, invalid: 0, stale: 0, pending: 0,
      },
    })).toEqual([])
  })
})
