import type { ProxyRule, RuleType } from '@uni-conf/types'
import { validateAndNormalizeRulePayload } from '@uni-conf/shared'

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

export interface ManualRulesParseResult {
  rules: ManualRuleForm[]
  invalidLineNumbers: number[]
  issues: ManualRuleParseIssue[]
  candidateCount: number
}

export type ManualRuleParseIssueReason =
  | 'unsupported-type'
  | 'missing-payload'
  | 'invalid-payload'
  | 'unknown-target'
  | 'unsupported-option'

export interface ManualRuleParseIssue {
  lineNumber: number
  reason: ManualRuleParseIssueReason
  detail: string
}

export function parseManualRules(
  text: string,
  targetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  startOrder: number
): ManualRuleForm[] {
  return parseManualRulesWithDiagnostics(text, targetGroupId, groups, startOrder).rules
}

export function parseManualRulesWithDiagnostics(
  text: string,
  targetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  startOrder: number
): ManualRulesParseResult {
  const rules: ManualRuleForm[] = []
  const invalidLineNumbers: number[] = []
  const issues: ManualRuleParseIssue[] = []
  let candidateCount = 0

  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parsed = parseManualRuleLineWithIssue(line, targetGroupId, groups, startOrder + candidateCount)
    candidateCount++
    if (parsed.rule) {
      rules.push(parsed.rule)
    } else {
      invalidLineNumbers.push(lineIndex + 1)
      issues.push({
        lineNumber: lineIndex + 1,
        reason: parsed.reason,
        detail: parsed.detail,
      })
    }
  }

  return { rules, invalidLineNumbers, issues, candidateCount }
}

export function parseManualRuleLine(
  line: string,
  fallbackTargetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  order: number
): ManualRuleForm | null {
  return parseManualRuleLineWithIssue(line, fallbackTargetGroupId, groups, order).rule
}

type ManualRuleLineResult =
  | { rule: ManualRuleForm; reason?: never; detail?: never }
  | { rule: null; reason: ManualRuleParseIssueReason; detail: string }

function parseManualRuleLineWithIssue(
  line: string,
  fallbackTargetGroupId: string,
  groups: Array<{ id: string; name: string }>,
  order: number
): ManualRuleLineResult {
  const parts = line.split(',').map(part => part.trim())
  const rawType = parts[0] ?? ''
  const type = rawType as RuleType
  if (!MANUAL_RULE_TYPES.includes(type)) {
    return { rule: null, reason: 'unsupported-type', detail: rawType || '—' }
  }

  const isMatch = type === 'MATCH'
  const payload = isMatch ? '' : parts[1] ?? ''
  if (!isMatch && !payload) {
    return { rule: null, reason: 'missing-payload', detail: type }
  }
  const payloadValidation = validateAndNormalizeRulePayload(type, payload)
  if (!payloadValidation.valid) {
    return { rule: null, reason: 'invalid-payload', detail: payloadValidation.code }
  }

  const targetIndex = isMatch ? 1 : 2
  const rawTarget = parts[targetIndex] ?? ''
  const targetIsOption = rawTarget.toLowerCase() === 'no-resolve'
  let targetGroupId = fallbackTargetGroupId
  if (rawTarget && !targetIsOption) {
    const resolvedTarget = resolveManualRuleGroupId(rawTarget, groups)
    if (!resolvedTarget) {
      return { rule: null, reason: 'unknown-target', detail: rawTarget }
    }
    targetGroupId = resolvedTarget
  }

  const options = [
    ...(targetIsOption ? [rawTarget] : []),
    ...parts.slice(targetIndex + 1).filter(Boolean),
  ]
  const unsupportedOptions = options.filter(option => option.toLowerCase() !== 'no-resolve')
  if (unsupportedOptions.length > 0) {
    return {
      rule: null,
      reason: 'unsupported-option',
      detail: [...new Set(unsupportedOptions)].join(', '),
    }
  }
  const noResolve = options.some(option => option.toLowerCase() === 'no-resolve')

  return {
    rule: {
      name: '',
      type,
      payload: payloadValidation.payload,
      targetGroupId,
      noResolve,
      enabled: true,
      order,
      compatibility: [],
      notes: '',
    },
  }
}

export function resolveManualRuleGroupId(
  target: string | undefined,
  groups: Array<{ id: string; name: string }>
): string | undefined {
  if (!target || target.toLowerCase() === 'no-resolve') return undefined
  return groups.find(group => group.id === target || group.name === target)?.id
}
