import type { ExportFormat, RuleType, CompatibilityLevel, ClientCompatibility, ProxyRule } from '@uni-conf/types'
import { getRuleCompatibilityLevel } from '@uni-conf/shared'

// ============================================================
// Compatibility Matrix
// ============================================================

const ALL_FORMATS: ExportFormat[] = [
  'mihomo', 'clash', 'singbox', 'loon', 'surge',
  'shadowrocket', 'quantumultx', 'stash', 'egern',
  'nodes_base64', 'nodes_raw',
]

export function checkRuleCompatibility(rule: ProxyRule, format: ExportFormat): ClientCompatibility {
  const level = getRuleCompatibilityLevel(rule.type, format) as CompatibilityLevel
  return { client: format, level }
}

export function checkAllCompatibility(rules: ProxyRule[]): ProxyRule[] {
  return rules.map((rule) => {
    const compatibility: ClientCompatibility[] = ALL_FORMATS.map((format) =>
      checkRuleCompatibility(rule, format),
    )
    return { ...rule, compatibility }
  })
}
