import {
  isFoundationPolicyGroupId,
  isRuleTargetFoundationGroupId,
} from '@uni-conf/shared'
import type { ProxyGroup } from '@uni-conf/types'

export function isNodeOutletGroup(group: ProxyGroup): boolean {
  return !group.isBuiltin && group.collectionIds.length > 0
}

export function isFoundationPolicyGroup(group: ProxyGroup): boolean {
  return isFoundationPolicyGroupId(group.id)
}

export function isRuleTargetFoundationGroup(group: ProxyGroup): boolean {
  return isRuleTargetFoundationGroupId(group.id)
}

export function isBuiltinBusinessRoutingGroup(group: ProxyGroup): boolean {
  return group.isBuiltin
    && !isFoundationPolicyGroup(group)
    && !['direct', 'reject'].includes(group.type)
    && group.collectionIds.length === 0
}

export function isCustomBusinessRoutingGroup(group: ProxyGroup): boolean {
  return !group.isBuiltin && !isNodeOutletGroup(group)
}

export function isVisibleBusinessRoutingGroup(group: ProxyGroup): boolean {
  return (isBuiltinBusinessRoutingGroup(group) && group.enabled) || isCustomBusinessRoutingGroup(group)
}
