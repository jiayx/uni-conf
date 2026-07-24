import type { ExportConfig, RuleSetConversionPolicy } from '@uni-conf/types'

export function resolveExportRuleSetConversionPolicy(
  config: Pick<ExportConfig, 'ruleSetConversionPolicy'>,
  globalPolicy: RuleSetConversionPolicy,
): RuleSetConversionPolicy {
  return config.ruleSetConversionPolicy === 'compatible'
    || config.ruleSetConversionPolicy === 'strict'
    ? config.ruleSetConversionPolicy
    : globalPolicy
}
