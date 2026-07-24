import type { DashboardStats } from '@uni-conf/types'

export type DashboardAttentionSeverity = 'error' | 'warning'
export type DashboardAttentionId =
  | 'source_refresh'
  | 'rule_source_invalid'
  | 'rule_source_review'
  | 'export_paused'
  | 'export_blocked'
  | 'export_notice'
  | 'export_unknown'

export interface DashboardAttentionItem {
  id: DashboardAttentionId
  severity: DashboardAttentionSeverity
  count: number
  to: string
}

export interface DashboardAttentionExportState {
  status: 'checking' | 'ready' | 'attention' | 'blocked' | 'unknown'
  issueCount?: number
  remediationTo?: string
  previewTo: string
}

export function deriveDashboardAttention(
  stats: DashboardStats,
  exportState: DashboardAttentionExportState,
): DashboardAttentionItem[] {
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
  const ruleSourceReviewCount = (ruleSetHealth?.warning ?? 0)
    + (ruleSetHealth?.stale ?? 0)
    + (ruleSetHealth?.pending ?? 0)
  if (ruleSourceReviewCount > 0) {
    items.push({
      id: 'rule_source_review',
      severity: 'warning',
      count: ruleSourceReviewCount,
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
  } else if (exportState.status === 'blocked') {
    items.push({
      id: 'export_blocked',
      severity: 'error',
      count: Math.max(1, exportState.issueCount ?? 0),
      to: exportState.remediationTo ?? exportState.previewTo,
    })
  } else if (exportState.status === 'attention') {
    items.push({
      id: 'export_notice',
      severity: 'warning',
      count: Math.max(1, exportState.issueCount ?? 0),
      to: exportState.previewTo,
    })
  } else if (exportState.status === 'unknown') {
    items.push({
      id: 'export_unknown',
      severity: 'warning',
      count: 1,
      to: exportState.previewTo,
    })
  }

  return items
}
