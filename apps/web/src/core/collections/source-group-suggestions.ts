import type { GroupType, NodeCollection, ProxyNode, ProxySource, SourceNodeGroup } from '@uni-conf/types'

export type SourceGroupImportType = Extract<GroupType, 'select' | 'url-test' | 'fallback'>

export const SOURCE_NODE_GROUP_PREFIX = '[uni-conf:source-node-group]'

export interface SourceGroupSuggestion {
  key: string
  sourceId: string
  sourceName: string
  groupName: string
  name: string
  group: SourceNodeGroup
  nodeIds: string[]
  exists: boolean
}

export function buildSourceGroupSuggestions(
  sources: ProxySource[],
  nodes: ProxyNode[],
  collections: NodeCollection[],
): SourceGroupSuggestion[] {
  const nodesBySourceAndName = new Map<string, ProxyNode>()
  for (const node of nodes) {
    nodesBySourceAndName.set(makeSourceNodeKey(node.sourceId, node.name), node)
  }

  const existingMarkers = new Set(
    collections
      .map(collection => parseSourceNodeGroupMarker(collection.notes))
      .filter((marker): marker is string => Boolean(marker))
  )

  return sources.flatMap(source => (source.groups ?? []).map(group => {
    const key = makeSourceNodeGroupKey(source.id, group.name)
    const nodeIds = group.memberNames
      .map(name => nodesBySourceAndName.get(makeSourceNodeKey(source.id, name))?.id)
      .filter((id): id is string => Boolean(id))

    return {
      key,
      sourceId: source.id,
      sourceName: source.name,
      groupName: group.name,
      name: `${source.name} / ${group.name}`,
      group,
      nodeIds,
      exists: existingMarkers.has(key),
    }
  })).sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.groupName.localeCompare(b.groupName))
}

export function makeSourceNodeGroupKey(sourceId: string, groupName: string): string {
  return `${sourceId}:${encodeURIComponent(groupName)}`
}

export function makeSourceNodeGroupMarker(sourceId: string, groupName: string): string {
  return `${SOURCE_NODE_GROUP_PREFIX} ${makeSourceNodeGroupKey(sourceId, groupName)}`
}

export function parseSourceNodeGroupMarker(notes?: string): string | null {
  if (!notes?.startsWith(SOURCE_NODE_GROUP_PREFIX)) return null
  return notes.slice(SOURCE_NODE_GROUP_PREFIX.length).trim() || null
}

export function mapUpstreamGroupType(type?: string): SourceGroupImportType {
  const normalized = type?.toLowerCase()
  if (normalized === 'select' || normalized === 'selector') return 'select'
  if (normalized === 'fallback') return 'fallback'
  return 'url-test'
}

function makeSourceNodeKey(sourceId: string, nodeName: string): string {
  return `${sourceId}\n${nodeName}`
}
