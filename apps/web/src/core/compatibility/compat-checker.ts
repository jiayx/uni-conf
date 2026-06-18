import type { ExportFormat, RuleType, CompatibilityLevel, ClientCompatibility, ProxyRule } from '@uni-conf/types'

// ============================================================
// Compatibility Matrix
// ============================================================

type CompatMatrix = Partial<Record<ExportFormat, CompatibilityLevel>>

const RULE_COMPAT: Record<RuleType, CompatMatrix> = {
  'DOMAIN': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'DOMAIN-SUFFIX': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'DOMAIN-KEYWORD': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'DOMAIN-REGEX': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported',
    surge: 'partial', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'partial',
  },
  'IP-CIDR': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'IP-CIDR6': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'IP-ASN': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported',
    surge: 'full', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'partial',
  },
  'GEOIP': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'GEOSITE': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial',
    surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'partial',
  },
  'PROCESS-NAME': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'partial',
  },
  'PROCESS-PATH': {
    mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'unsupported',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'partial', egern: 'unsupported',
  },
  'PORT': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'SRC-PORT': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported',
  },
  'SRC-IP-CIDR': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported',
  },
  'PROTOCOL': {
    mihomo: 'full', clash: 'full', singbox: 'partial', loon: 'unsupported',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported',
  },
  'NETWORK': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported',
    surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported',
  },
  'IN-TYPE': {
    mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'unsupported',
    surge: 'unsupported', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'unsupported', egern: 'unsupported',
  },
  'RULE-SET': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'partial', quantumultx: 'full', stash: 'full', egern: 'full',
  },
  'SCRIPT': {
    mihomo: 'partial', clash: 'partial', singbox: 'unsupported', loon: 'partial',
    surge: 'full', shadowrocket: 'unsupported', quantumultx: 'full', stash: 'partial', egern: 'unsupported',
  },
  'MATCH': {
    mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full',
    surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full',
  },
}

const ALL_FORMATS: ExportFormat[] = [
  'mihomo', 'clash', 'singbox', 'loon', 'surge',
  'shadowrocket', 'quantumultx', 'stash', 'egern',
  'nodes_base64', 'nodes_raw',
]

export function checkRuleCompatibility(rule: ProxyRule, format: ExportFormat): ClientCompatibility {
  const matrix = RULE_COMPAT[rule.type]
  const level = matrix?.[format] ?? 'unsupported'
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
