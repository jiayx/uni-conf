import type { CompatibilityTransformation, CompatibilityWarning } from '@uni-conf/types'

export type TransformationReportFilter = 'all' | 'changed' | 'skipped' | 'blocked'

export interface TransformationReportSummary {
  total: number
  changed: number
  skipped: number
  blocked: number
}

export function summarizeTransformations(
  warnings: CompatibilityWarning[],
): TransformationReportSummary {
  const transformations = warnings.flatMap(warning =>
    warning.transformation ? [warning.transformation] : [],
  )
  return {
    total: transformations.length,
    changed: transformations.filter(isChangedTransformation).length,
    skipped: transformations.filter(item => item.action === 'skip').length,
    blocked: transformations.filter(item => item.action === 'block').length,
  }
}

export function filterTransformationWarnings(
  warnings: CompatibilityWarning[],
  filter: TransformationReportFilter,
): CompatibilityWarning[] {
  return warnings.filter(warning => {
    const transformation = warning.transformation
    if (!transformation) return false
    if (filter === 'all') return true
    if (filter === 'changed') return isChangedTransformation(transformation)
    if (filter === 'skipped') return transformation.action === 'skip'
    return transformation.action === 'block'
  })
}

function isChangedTransformation(transformation: CompatibilityTransformation): boolean {
  return ['convert', 'degrade', 'omit-option', 'reorder'].includes(transformation.action)
}
