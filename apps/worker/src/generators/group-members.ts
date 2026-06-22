type Row = Record<string, unknown>

export function collectGroupMembers(
  group: Row,
  groups: Row[],
  nodeNames: string[],
  collectionNodeNames: Record<string, string[]> = {},
  resolveNestedGroupName: (group: Row) => string = (item) => String(item['name'] ?? '')
): string[] {
  const groupIds = safeJsonArray(group['group_ids'])
  const collectionIds = safeJsonArray(group['collection_ids'])
  const builtins = safeJsonArray(group['builtins'])
  const validNodeNames = new Set(nodeNames)
  const nested = groupIds
    .map((id) => groups.find((item) => String(item['id']) === id))
    .filter((item): item is Row => Boolean(item))
    .map(resolveNestedGroupName)

  const scopedNodeNames = collectionIds
    .flatMap((id) => collectionNodeNames[id] ?? [])
    .filter((name) => validNodeNames.has(name))

  const nodeMembers = scopedNodeNames.length > 0
    ? scopedNodeNames
    : collectionIds.length === 0 && groupIds.length === 0 && builtins.length === 0
      ? nodeNames
      : []
  const members = [...builtins, ...nested, ...nodeMembers].filter(Boolean)

  return [...new Set(members.length > 0 ? members : ['DIRECT'])]
}

function safeJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
