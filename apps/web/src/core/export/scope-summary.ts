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
  const eligibleRules = rules.filter(rule => rule.enabled && exportedGroupIds.has(rule.targetGroupId))
  const eligibleRemoteSets = remoteSets.filter(set => (
    set.enabled && exportedGroupIds.has(set.targetGroupId) && isRemoteRuleSetCompatible(config.format, set)
  ))
  const details = [
    summaryPart(t('export.scope_summary_collections'), collections.filter(item => item.enabled), config.includeCollectionIds, t),
    t('export.scope_summary_count', { label: t('export.scope_summary_groups'), selected: exportedGroupIds.size, count: groups.filter(group => group.enabled).length }),
    summaryPart(t('export.scope_summary_rules'), eligibleRules, config.includeRuleIds, t),
    summaryPart(t('export.scope_summary_remote_sets'), eligibleRemoteSets, config.includeRemoteSetIds, t),
  ].join(' · ')
  return t('export.scope_summary_custom', { details })
}

function summaryPart(
  label: string,
  eligible: Array<{ id: string }>,
  ids: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const selected = new Set(ids)
  return t('export.scope_summary_count', {
    label,
    selected: ids.length === 0 ? eligible.length : eligible.filter(item => selected.has(item.id)).length,
    count: eligible.length,
  })
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
