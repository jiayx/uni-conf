import type { DashboardStats } from '@uni-conf/types'

export type DashboardJourneyReadiness =
  | 'checking'
  | 'ready'
  | 'attention'
  | 'blocked'
  | 'unknown'

export type DashboardJourneyStageStatus =
  | 'complete'
  | 'current'
  | 'pending'
  | 'attention'
  | 'blocked'

export type DashboardJourneyDetail =
  | 'input_needed'
  | 'input_ready'
  | 'generated_pending'
  | 'collections_missing'
  | 'groups_missing'
  | 'export_profile_missing'
  | 'generated_ready'
  | 'export_pending'
  | 'export_paused'
  | 'export_checking'
  | 'export_ready'
  | 'export_attention'
  | 'export_blocked'
  | 'export_unknown'

export interface DashboardJourneyStage {
  id: 'input' | 'generated' | 'export'
  status: DashboardJourneyStageStatus
  detail: DashboardJourneyDetail
  to: string
}

export function deriveDashboardJourney(
  stats: DashboardStats,
  readiness: DashboardJourneyReadiness,
  exportRemediationTo?: string,
  previewTo = '/preview',
): DashboardJourneyStage[] {
  const inputReady = stats.enabledNodeCount > 0
  const input: DashboardJourneyStage = {
    id: 'input',
    status: inputReady ? 'complete' : 'current',
    detail: inputReady ? 'input_ready' : 'input_needed',
    to: '/sources',
  }

  if (!inputReady) {
    return [
      input,
      {
        id: 'generated',
        status: 'pending',
        detail: 'generated_pending',
        to: '/collections',
      },
      {
        id: 'export',
        status: 'pending',
        detail: 'export_pending',
        to: '/export',
      },
    ]
  }

  const generatedIssue = stats.collectionCount === 0
    ? { detail: 'collections_missing' as const, to: '/collections' }
    : stats.groupCount === 0
      ? { detail: 'groups_missing' as const, to: '/groups' }
      : stats.exportConfigCount === 0
        ? { detail: 'export_profile_missing' as const, to: '/export' }
        : null
  const generated: DashboardJourneyStage = generatedIssue
    ? {
        id: 'generated',
        status: 'current',
        ...generatedIssue,
      }
    : {
        id: 'generated',
        status: 'complete',
        detail: 'generated_ready',
        to: '/groups',
      }

  if (generatedIssue) {
    return [
      input,
      generated,
      {
        id: 'export',
        status: 'pending',
        detail: 'export_pending',
        to: '/export',
      },
    ]
  }

  if (stats.defaultExportEnabled === false) {
    return [
      input,
      generated,
      {
        id: 'export',
        status: 'blocked',
        detail: 'export_paused',
        to: '/export',
      },
    ]
  }

  const exportStageByReadiness: Record<DashboardJourneyReadiness, DashboardJourneyStage> = {
    checking: {
      id: 'export',
      status: 'current',
      detail: 'export_checking',
      to: previewTo,
    },
    ready: {
      id: 'export',
      status: 'complete',
      detail: 'export_ready',
      to: '/export',
    },
    attention: {
      id: 'export',
      status: 'attention',
      detail: 'export_attention',
      to: previewTo,
    },
    blocked: {
      id: 'export',
      status: 'blocked',
      detail: 'export_blocked',
      to: exportRemediationTo ?? previewTo,
    },
    unknown: {
      id: 'export',
      status: 'current',
      detail: 'export_unknown',
      to: previewTo,
    },
  }

  return [input, generated, exportStageByReadiness[readiness]]
}
