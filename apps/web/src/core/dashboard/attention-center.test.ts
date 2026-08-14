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
}

describe('deriveDashboardAttention', () => {
  it('reports persisted failures', () => {
    expect(deriveDashboardAttention(stats)).toEqual([
      { id: 'source_refresh', severity: 'warning', count: 2, to: '/sources?attention=refresh' },
    ])
  })

  it('reports a paused public profile', () => {
    expect(deriveDashboardAttention({
      ...stats,
      sourceRefreshFailureCount: 0,
      defaultExportEnabled: false,
    })).toEqual([
      { id: 'export_paused', severity: 'error', count: 1, to: '/export' },
    ])
  })

  it('returns no items for a healthy system', () => {
    expect(deriveDashboardAttention({
      ...stats,
      sourceRefreshFailureCount: 0,
    })).toEqual([])
  })
})
