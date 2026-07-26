import type { DashboardStats } from '@uni-conf/types'

export type DashboardAttentionSeverity = 'error' | 'warning'
export type DashboardAttentionId =
  | 'source_refresh'
  | 'rule_source_invalid'
  | 'export_paused'

export interface DashboardAttentionItem {
  id: DashboardAttentionId
  severity: DashboardAttentionSeverity
  count: number
  to: string
}

export function deriveDashboardAttention(stats: DashboardStats): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = []

  if ((stats.sourceRefreshFailureCount ?? 0) > 0) {
    items.push({
      id: 'source_refresh',
      severity: 'warning',
      count: stats.sourceRefreshFailureCount!,
      to: '/sources?attention=refresh',
    })
  }

  const ruleSetHealth = stats.ruleSetHealth
  if ((ruleSetHealth?.invalid ?? 0) > 0) {
    items.push({
      id: 'rule_source_invalid',
      severity: 'error',
      count: ruleSetHealth!.invalid,
      to: '/remote-rule-sets?attention=1',
    })
  }
  if (stats.defaultExportEnabled === false) {
    items.push({
      id: 'export_paused',
      severity: 'error',
      count: 1,
      to: '/export',
    })
  }

  return items
}
