import type { ProxyNode, NodeCollection } from '@uni-conf/types'
import { filterNodes } from './node-filter'
import { renameNodes } from './node-rename'
import { dedupNodes } from './node-dedup'
import { sortNodes } from './node-sort'

export function processCollection(
  allNodes: ProxyNode[],
  collection: NodeCollection,
): ProxyNode[] {
  // 1. Filter by sourceIds (if empty, use all)
  let nodes =
    collection.sourceIds.length > 0
      ? allNodes.filter((n) => collection.sourceIds.includes(n.sourceId))
      : allNodes

  // 2. Apply filters
  nodes = filterNodes(nodes, collection.filters)

  // 3. Apply renames
  nodes = renameNodes(nodes, collection.renames)

  // 4. Apply dedup
  nodes = dedupNodes(nodes, collection.dedup)

  // 5. Sort
  nodes = sortNodes(nodes, collection.sort, collection.sortCountryOrder)

  return nodes
}
