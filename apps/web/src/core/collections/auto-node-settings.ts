import type { AppSettings, AutoNodeGroupType } from '@uni-conf/types'

const AUTO_NODE_GROUP_TYPE_ORDER: AutoNodeGroupType[] = ['select', 'url-test', 'fallback']

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
