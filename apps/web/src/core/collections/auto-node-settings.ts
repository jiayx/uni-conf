import {
  AUTO_NODE_GROUP_TYPE_ORDER,
  AUTO_NODE_TAG_GROUPS,
  makeCountryAutoNodeGroupKey,
  makeTagAutoNodeGroupKey,
} from '@uni-conf/shared'
import type { AppSettingsPatch, AutoNodeGroupType, ProxyNode } from '@uni-conf/types'

type AutoNodeGroupSettingsPatch = Pick<AppSettingsPatch, 'autoNodeGroupsEnabled' | 'autoNodeGroupTypes' | 'autoNodeGroupKeys' | 'autoNodeGroupIncludeFlag'> & {
  autoNodeGroupsEnabled: boolean
  autoNodeGroupTypes: AutoNodeGroupType[]
  autoNodeGroupKeys: string[]
  autoNodeGroupIncludeFlag: boolean
}

type AutoNodeGroupTypeSettingsPatch = Pick<AppSettingsPatch, 'autoNodeGroupsEnabled' | 'autoNodeGroupTypes'> & {
  autoNodeGroupsEnabled: boolean
  autoNodeGroupTypes: AutoNodeGroupType[]
}

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
}): AutoNodeGroupSettingsPatch {
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
): AutoNodeGroupTypeSettingsPatch {
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
