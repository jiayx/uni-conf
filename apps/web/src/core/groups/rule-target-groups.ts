import {
  DEFAULT_RULE_TARGET_GROUP_ID,
  isRuleTargetGroup as isSharedRuleTargetGroup,
} from '@uni-conf/shared'

export function isRuleTargetGroup(group: { id: string; collectionIds: string[] }): boolean {
  return isSharedRuleTargetGroup(group)
}

export function getDefaultRuleTargetGroupId(groups: Array<{ id: string; name: string }>): string {
  return groups.find(group => group.id === DEFAULT_RULE_TARGET_GROUP_ID)?.id
    ?? groups.find(group => group.name === 'PROXY')?.id
    ?? groups[0]?.id
    ?? DEFAULT_RULE_TARGET_GROUP_ID
}
