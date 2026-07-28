import {
  resolveRuleForExport,
  getRuleNoResolveHandling,
  type RuleCompatibilityLevel,
} from '@uni-conf/shared'
import type { ExportFormat, RuleType } from '@uni-conf/types'

export interface BatchRuleCompatibilityInput {
  type: RuleType
  payload: string
  noResolve?: boolean
}

export interface BatchRuleCompatibilitySummary {
  format: ExportFormat
  total: number
  full: number
  convert: number
  partial: number
  unsupported: number
  optionOmitted: number
}

export function summarizeBatchRuleCompatibility(
  rules: BatchRuleCompatibilityInput[],
  formats: ExportFormat[],
): BatchRuleCompatibilitySummary[] {
  return formats.map(format => {
    const summary: BatchRuleCompatibilitySummary = {
      format,
      total: rules.length,
      full: 0,
      convert: 0,
      partial: 0,
      unsupported: 0,
      optionOmitted: 0,
    }
    for (const rule of rules) {
      const resolution = resolveRuleForExport(rule.type, rule.payload, format)
      incrementLevel(summary, resolution.level)
      if (rule.noResolve && getRuleNoResolveHandling(rule.type, format) === 'omit') {
        summary.optionOmitted++
      }
    }
    return summary
  })
}

function incrementLevel(
  summary: BatchRuleCompatibilitySummary,
  level: RuleCompatibilityLevel,
): void {
  summary[level]++
}
