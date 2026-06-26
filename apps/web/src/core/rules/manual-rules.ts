import type { ProxyRule, RuleType } from '@uni-conf/types'

export type ManualRuleForm = Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>

export const MANUAL_RULE_TYPES: RuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-ASN',
  'GEOIP',
  'GEOSITE',
  'PROCESS-NAME',
  'PROCESS-PATH',
  'PORT',
  'SRC-PORT',
  'SRC-IP-CIDR',
  'PROTOCOL',
  'NETWORK',
  'RULE-SET',
  'MATCH',
]

export function parseManualRules(
  text: string,
  targetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  startOrder: number
): ManualRuleForm[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((line, index) => parseManualRuleLine(line, targetGroupId, groups, startOrder + index))
    .filter((rule): rule is ManualRuleForm => Boolean(rule))
}

export function parseManualRuleLine(
  line: string,
  fallbackTargetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  order: number
): ManualRuleForm | null {
  const parts = line.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const type = parts[0] as RuleType
  if (!MANUAL_RULE_TYPES.includes(type)) return null

  const isMatch = type === 'MATCH'
  const noResolve = parts.some(part => part.toLowerCase() === 'no-resolve')
  const payload = isMatch ? '' : parts[1] ?? ''
  if (!isMatch && !payload) return null
  const targetText = isMatch ? parts[1] : parts[2]
  const targetGroupId = resolveManualRuleGroupId(targetText, groups) ?? fallbackTargetGroupId

  return {
    name: '',
    type,
    payload,
    targetGroupId,
    noResolve,
    enabled: true,
    order,
    compatibility: [],
    notes: '',
  }
}

export function resolveManualRuleGroupId(
  target: string | undefined,
  groups: Array<{ id: string; name: string }>
): string | undefined {
  if (!target || target.toLowerCase() === 'no-resolve') return undefined
  return groups.find(group => group.id === target || group.name === target)?.id
}
