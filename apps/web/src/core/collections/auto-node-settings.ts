import type { AppSettings, AutoNodeGroupType, ProxyNode } from '@uni-conf/types'

const AUTO_NODE_GROUP_TYPE_ORDER: AutoNodeGroupType[] = ['select', 'url-test', 'fallback']
const TAG_AUTO_GROUPS = [
  { key: 'streaming', label: 'Streaming / Unlock', tags: ['streaming', 'unlock'] },
  { key: 'native', label: 'Native / Residential', tags: ['residential', 'native-ip'] },
] as const

export interface AutoNodeGroupMarker {
  scope: 'country' | 'tag'
  countryCode?: string
  tagKey?: string
  type: AutoNodeGroupType
  key: string
}

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
  return TAG_AUTO_GROUPS
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

export function makeCountryAutoNodeGroupKey(countryCode: string, type: AutoNodeGroupType): string {
  return `country:${countryCode.trim().toUpperCase()}:${type}`
}

export function makeTagAutoNodeGroupKey(tagKey: string, type: AutoNodeGroupType): string {
  return `tag:${tagKey}:${type}`
}

export function parseAutoNodeGroupKey(key: string): AutoNodeGroupMarker | null {
  const parts = key.split(':')
  if (parts.length !== 3) return null

  const [scope, value, type] = parts
  if (!AUTO_NODE_GROUP_TYPE_ORDER.includes(type as AutoNodeGroupType)) return null
  const normalizedType = type as AutoNodeGroupType
  if (scope === 'country' && value) {
    const normalizedCode = value.trim().toUpperCase()
    return { scope, countryCode: normalizedCode, type: normalizedType, key: makeCountryAutoNodeGroupKey(normalizedCode, normalizedType) }
  }
  if (scope === 'tag' && value) {
    return { scope, tagKey: value, type: normalizedType, key: makeTagAutoNodeGroupKey(value, normalizedType) }
  }
  return null
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
