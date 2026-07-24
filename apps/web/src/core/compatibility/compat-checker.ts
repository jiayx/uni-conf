import type { ExportFormat, CompatibilityLevel, ClientCompatibility, ProxyRule } from '@uni-conf/types'
import { getRuleCompatibilityForPayload, resolveRuleForExport } from '@uni-conf/shared'

// ============================================================
// Compatibility Matrix
// ============================================================

export function checkRuleCompatibility(rule: ProxyRule, format: ExportFormat): ClientCompatibility {
  const level = resolveRuleForExport(rule.type, rule.payload, format).level as CompatibilityLevel
  return { client: format, level }
}

export function checkAllCompatibility(rules: ProxyRule[]): ProxyRule[] {
  return rules.map((rule) => {
    const compatibility = getRuleCompatibilityForPayload(rule.type, rule.payload) as ClientCompatibility[]
    return { ...rule, compatibility }
  })
}
