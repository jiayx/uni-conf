import { summarizeExportWarnings, type ExportWarningSummary } from './warning-summary'
import type { ExportReadinessResult } from '@uni-conf/types'

export interface ExportReadiness {
  status: 'ready' | 'attention' | 'blocked'
  summary: ExportWarningSummary
  structureValid: boolean
}

export function deriveExportReadiness(result: ExportReadinessResult): ExportReadiness {
  const summary = summarizeExportWarnings(result.warnings ?? [])
  const structureValid = result.artifactValidation?.valid === true
  const blocked = !result.readiness.ready || !structureValid

  return {
    status: blocked ? 'blocked' : summary.total > 0 ? 'attention' : 'ready',
    summary,
    structureValid,
  }
}
