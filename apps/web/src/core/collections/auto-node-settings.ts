import {
  AUTO_NODE_GROUP_TYPE_ORDER,
  AUTO_NODE_TAG_GROUPS,
  makeCountryAutoNodeGroupKey,
  makeTagAutoNodeGroupKey,
  parseAutoNodeGroupKey,
  type AutoNodeGroupMarker,
} from '@uni-conf/shared'
import type { AppSettings, AutoNodeGroupType, ProxyNode } from '@uni-conf/types'

export {
  makeCountryAutoNodeGroupKey,
  makeTagAutoNodeGroupKey,
  parseAutoNodeGroupKey,
  type AutoNodeGroupMarker,
} from '@uni-conf/shared'

export function normalizeAutoNodeGroupTypeSelection(types: Iterable<AutoNodeGroupType>): AutoNodeGroupType[] {
  const selected = new Set(types)
  return AUTO_NODE_GROUP_TYPE_ORDER.filter(type => selected.has(type))
}

export function toggleAutoNodeGroupTypeSelection(
  currentTypes: readonly AutoNodeGroupType[],
  type: AutoNodeGroupType
): AutoNodeGroupType[] {
  const selected = new Set(currentTypes)
  if (selected.has(type)) {
    selected.delete(type)
  } else {
    selected.add(type)
  }
  return normalizeAutoNodeGroupTypeSelection(selected)
}

export function buildAutoNodeGroupSettingsPatch({
  selectedTypes,
  selectedKeys,
  includeFlag,
}: {
  selectedTypes: Iterable<AutoNodeGroupType>
  selectedKeys: Iterable<string>
  includeFlag: boolean
}): Pick<AppSettings, 'autoNodeGroupsEnabled' | 'autoNodeGroupTypes' | 'autoNodeGroupKeys' | 'autoNodeGroupIncludeFlag'> {
  const autoNodeGroupTypes = normalizeAutoNodeGroupTypeSelection(selectedTypes)
  const autoNodeGroupKeys = [...selectedKeys]
  return {
    autoNodeGroupsEnabled: autoNodeGroupTypes.length > 0 && autoNodeGroupKeys.length > 0,
    autoNodeGroupTypes,
    autoNodeGroupKeys,
    autoNodeGroupIncludeFlag: includeFlag,
  }
}

export function buildAutoNodeGroupTypeSettingsPatch(
  currentTypes: readonly AutoNodeGroupType[],
  type: AutoNodeGroupType
): Pick<AppSettings, 'autoNodeGroupsEnabled' | 'autoNodeGroupTypes'> {
  const autoNodeGroupTypes = toggleAutoNodeGroupTypeSelection(currentTypes, type)
  return {
    autoNodeGroupsEnabled: autoNodeGroupTypes.length > 0,
    autoNodeGroupTypes,
  }
}

export function buildAutoNodeTagSuggestions(nodes: ProxyNode[]): Array<{ key: string; label: string; count: number }> {
  return AUTO_NODE_TAG_GROUPS
    .map(group => ({
      key: group.key,
      label: group.label,
      count: nodes.filter(node =>
        !node.tags.includes('high-multiplier')
        && group.tags.some(tag => node.tags.includes(tag))
      ).length,
    }))
    .filter(item => item.count > 0)
}

export function buildAutoNodeGroupKeysForSuggestions({
  countryCodes,
  tagKeys,
  types,
}: {
  countryCodes: Iterable<string>
  tagKeys: Iterable<string>
  types: Iterable<AutoNodeGroupType>
}): Set<string> {
  const selectedTypes = [...types]
  const keys = new Set<string>()
  for (const countryCode of countryCodes) {
    for (const type of selectedTypes) {
      keys.add(makeCountryAutoNodeGroupKey(countryCode, type))
    }
  }
  for (const tagKey of tagKeys) {
    for (const type of selectedTypes) {
      keys.add(makeTagAutoNodeGroupKey(tagKey, type))
    }
  }
  return keys
}

export function rebuildAutoNodeGroupKeysForTypes(
  source: Iterable<string>,
  types: Iterable<AutoNodeGroupType>
): Set<string> {
  const selectedTypes = new Set(types)
  const parsedMarkers = [...source]
    .map(key => parseAutoNodeGroupKey(key))
    .filter((marker): marker is AutoNodeGroupMarker => Boolean(marker))
  const countries = new Set(parsedMarkers.map(marker => marker.countryCode).filter((value): value is string => Boolean(value)))
  const tagKeys = new Set(parsedMarkers.map(marker => marker.tagKey).filter((value): value is string => Boolean(value)))
  const next = new Set<string>()

  for (const countryCode of countries) {
    for (const type of selectedTypes) {
      next.add(makeCountryAutoNodeGroupKey(countryCode, type))
    }
  }
  for (const tagKey of tagKeys) {
    for (const type of selectedTypes) {
      next.add(makeTagAutoNodeGroupKey(tagKey, type))
    }
  }

  return next
}
