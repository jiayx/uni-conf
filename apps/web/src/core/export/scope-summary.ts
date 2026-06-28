import type { ExportConfig, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import { isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'

export function exportConfigScopeSummary(
  config: ExportConfig,
  collections: NodeCollection[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[]
): string {
  return [
    summaryPart('节点组', config.includeCollectionIds, enabledCount(collections)),
    summaryPart('策略组与出口', config.includeGroupIds, enabledCount(groups)),
    summaryPart('手动规则', config.includeRuleIds, enabledCount(rules)),
    summaryPart('兼容分流规则集', config.includeRemoteSetIds, compatibleRemoteSetCount(config, remoteSets)),
  ].join(' / ')
}

function summaryPart(label: string, ids: string[], eligibleCount: number): string {
  return ids.length === 0 ? `${label}: 全部启用 ${eligibleCount}` : `${label}: 已选 ${ids.length}/${eligibleCount}`
}

function enabledCount(items: Array<{ enabled: boolean }>): number {
  return items.filter(item => item.enabled).length
}

function compatibleRemoteSetCount(config: ExportConfig, remoteSets: RemoteRuleSet[]): number {
  return remoteSets.filter(set => set.enabled && isRemoteRuleSetCompatible(config.format, set)).length
}
