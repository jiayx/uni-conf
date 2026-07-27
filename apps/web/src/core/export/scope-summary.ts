import type { ExportConfig, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import { isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'

export function exportConfigScopeSummary(
  config: ExportConfig,
  collections: NodeCollection[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const isUnrestricted = (
    config.includeCollectionIds.length === 0
    && config.includeGroupIds.length === 0
    && config.includeRuleIds.length === 0
    && config.includeRemoteSetIds.length === 0
  )
  if (isUnrestricted) return t('export.scope_summary_all')

  const exportedGroupIds = resolveExportedGroupIds(config, groups)
  const details = [
    summaryPart(t('export.scope_summary_collections'), enabledCount(collections), selectedEnabledCount(collections, config.includeCollectionIds), t),
    summaryPart(t('export.scope_summary_groups'), enabledCount(groups), exportedGroupIds.size, t),
    summaryPart(t('export.scope_summary_rules'), targetExportableCount(rules, exportedGroupIds), selectedTargetExportableCount(rules, config.includeRuleIds, exportedGroupIds), t),
    summaryPart(t('export.scope_summary_remote_sets'), compatibleRemoteSetCount(config, remoteSets, exportedGroupIds), selectedCompatibleRemoteSetCount(config, remoteSets, config.includeRemoteSetIds, exportedGroupIds), t),
  ].join(' · ')
  return t('export.scope_summary_custom', { details })
}

function summaryPart(
  label: string,
  eligibleCount: number,
  selectedCount: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t('export.scope_summary_count', {
    label,
    selected: selectedCount,
    count: eligibleCount,
  })
}

function enabledCount(items: Array<{ enabled: boolean }>): number {
  return items.filter(item => item.enabled).length
}

function selectedEnabledCount(items: Array<{ id: string; enabled: boolean }>, ids: string[]): number {
  if (ids.length === 0) return enabledCount(items)
  const selectedIds = new Set(ids)
  return items.filter(item => item.enabled && selectedIds.has(item.id)).length
}

function targetExportableCount(items: Array<{ enabled: boolean; targetGroupId: string }>, exportedGroupIds: Set<string>): number {
  return items.filter(item => item.enabled && exportedGroupIds.has(item.targetGroupId)).length
}

function selectedTargetExportableCount(
  items: Array<{ id: string; enabled: boolean; targetGroupId: string }>,
  ids: string[],
  exportedGroupIds: Set<string>
): number {
  if (ids.length === 0) return targetExportableCount(items, exportedGroupIds)
  const selectedIds = new Set(ids)
  return items.filter(item => selectedIds.has(item.id) && item.enabled && exportedGroupIds.has(item.targetGroupId)).length
}

function compatibleRemoteSetCount(config: ExportConfig, remoteSets: RemoteRuleSet[], exportedGroupIds: Set<string>): number {
  return remoteSets.filter(set => set.enabled && exportedGroupIds.has(set.targetGroupId) && isRemoteRuleSetCompatible(config.format, set)).length
}

function selectedCompatibleRemoteSetCount(
  config: ExportConfig,
  remoteSets: RemoteRuleSet[],
  ids: string[],
  exportedGroupIds: Set<string>
): number {
  if (ids.length === 0) return compatibleRemoteSetCount(config, remoteSets, exportedGroupIds)
  const selectedIds = new Set(ids)
  return remoteSets.filter(set => (
    selectedIds.has(set.id)
    && set.enabled
    && exportedGroupIds.has(set.targetGroupId)
    && isRemoteRuleSetCompatible(config.format, set)
  )).length
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
