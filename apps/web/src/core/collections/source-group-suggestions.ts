import type { GroupType, NodeCollection, ProxyNode, ProxySource, SourceNodeGroup } from '@uni-conf/types'
import {
  extractSourceNodeGroupMarkerKey,
  makeSourceNodeGroupKey,
  makeSourceNodeGroupMarker,
  SOURCE_NODE_GROUP_PREFIX,
} from '@uni-conf/shared'

export type SourceGroupImportType = Extract<GroupType, 'select' | 'url-test' | 'fallback'>

export {
  makeSourceNodeGroupKey,
  makeSourceNodeGroupMarker,
  SOURCE_NODE_GROUP_PREFIX,
}

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

export function parseSourceNodeGroupMarker(notes?: string): string | null {
  return extractSourceNodeGroupMarkerKey(notes)
}

export function mapUpstreamGroupType(type?: string): SourceGroupImportType {
  const normalized = type?.toLowerCase()
  if (normalized === 'select' || normalized === 'selector') return 'select'
  if (normalized === 'fallback') return 'fallback'
  return 'url-test'
}

export function nextSourceGroupLinkedOrder(existingGroupCount: number, importedIndex: number): number {
  return Math.max(0, existingGroupCount) + Math.max(0, importedIndex)
}

function makeSourceNodeKey(sourceId: string, nodeName: string): string {
  return `${sourceId}\n${nodeName}`
}
