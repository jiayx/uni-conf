import type { ExportFormat, CompatibilityLevel, ClientCompatibility, ProxyRule } from '@uni-conf/types'
import { getRuleCompatibility, getRuleCompatibilityLevel } from '@uni-conf/shared'

// ============================================================
// Compatibility Matrix
// ============================================================

export function checkRuleCompatibility(rule: ProxyRule, format: ExportFormat): ClientCompatibility {
  const level = getRuleCompatibilityLevel(rule.type, format) as CompatibilityLevel
  return { client: format, level }
}

export function checkAllCompatibility(rules: ProxyRule[]): ProxyRule[] {
  return rules.map((rule) => {
    const compatibility = getRuleCompatibility(rule.type) as ClientCompatibility[]
    return { ...rule, compatibility }
  })
}
