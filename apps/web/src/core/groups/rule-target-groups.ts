import { isRuleTargetGroup as isSharedRuleTargetGroup } from '@uni-conf/shared'

export function isRuleTargetGroup(group: { id: string; collectionIds: string[] }): boolean {
  return isSharedRuleTargetGroup(group)
}
