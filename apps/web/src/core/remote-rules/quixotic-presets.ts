import type { RuleSetFormat } from '@uni-conf/types'
import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
  resolveQuixoticRuleSetBehavior,
  resolveQuixoticRuleSetSortOrder,
  type InferredRuleSetTargetGroup,
  type QuixoticRuleSetPreset,
} from '@uni-conf/shared'

export {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
  resolveQuixoticRuleSetBehavior,
  resolveQuixoticRuleSetSortOrder,
}

export type {
  InferredRuleSetTargetGroup,
  QuixoticRuleSetPreset,
}

export const RULE_SET_FORMAT_OPTIONS: Array<{ value: RuleSetFormat; label: string; exportTargets: string }> = [
  { value: 'mihomo', label: 'Mihomo / Clash Meta', exportTargets: 'Mihomo / Clash / Stash' },
  { value: 'clash', label: 'Clash Classical', exportTargets: 'Mihomo / Clash' },
  { value: 'singbox', label: 'sing-box SRS', exportTargets: 'sing-box' },
  { value: 'surge', label: 'Surge', exportTargets: 'Surge' },
  { value: 'loon', label: 'Loon', exportTargets: 'Loon' },
  { value: 'shadowrocket', label: 'Shadowrocket', exportTargets: 'Shadowrocket' },
  { value: 'quantumultx', label: 'Quantumult X', exportTargets: 'Quantumult X' },
  { value: 'egern', label: 'Egern', exportTargets: 'Egern' },
  { value: 'stash', label: 'Stash', exportTargets: 'Stash / Mihomo-compatible clients' },
  { value: 'text', label: 'Text', exportTargets: 'Domain list fallback' },
]
