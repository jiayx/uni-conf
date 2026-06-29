import type { ExportConfig, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import { isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'

export function exportConfigScopeSummary(
  config: ExportConfig,
  collections: NodeCollection[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[]
): string {
  const exportedGroupIds = resolveExportedGroupIds(config, groups)
  return [
    summaryPart('节点组', config.includeCollectionIds, enabledCount(collections)),
    summaryPart('策略组与出口', config.includeGroupIds, enabledCount(groups)),
    summaryPart('手动规则', config.includeRuleIds, targetExportableCount(rules, exportedGroupIds)),
    summaryPart('兼容分流规则集', config.includeRemoteSetIds, compatibleRemoteSetCount(config, remoteSets, exportedGroupIds)),
  ].join(' / ')
}

function summaryPart(label: string, ids: string[], eligibleCount: number): string {
  return ids.length === 0 ? `${label}: 全部启用 ${eligibleCount}` : `${label}: 已选 ${ids.length}/${eligibleCount}`
}

function enabledCount(items: Array<{ enabled: boolean }>): number {
  return items.filter(item => item.enabled).length
}

function targetExportableCount(items: Array<{ enabled: boolean; targetGroupId: string }>, exportedGroupIds: Set<string>): number {
  return items.filter(item => item.enabled && exportedGroupIds.has(item.targetGroupId)).length
}

function compatibleRemoteSetCount(config: ExportConfig, remoteSets: RemoteRuleSet[], exportedGroupIds: Set<string>): number {
  return remoteSets.filter(set => set.enabled && exportedGroupIds.has(set.targetGroupId) && isRemoteRuleSetCompatible(config.format, set)).length
}

function resolveExportedGroupIds(config: ExportConfig, groups: ProxyGroup[]): Set<string> {
  const enabledGroupsById = new Map(groups.filter(group => group.enabled).map(group => [group.id, group]))
  if (config.includeGroupIds.length === 0) return new Set(enabledGroupsById.keys())

  const selected = new Set<string>()
  const pending = [...config.includeGroupIds]
  while (pending.length > 0) {
    const id = pending.shift()
    if (!id || selected.has(id)) continue
    const group = enabledGroupsById.get(id)
    if (!group) continue
    selected.add(id)
    for (const childId of group.groupIds) {
      if (!selected.has(childId)) pending.push(childId)
    }
  }
  return selected
}
