export interface GroupReferenceNode {
  id: string
  groupIds: readonly string[]
}

export function validateGroupReferenceGraph(nodes: readonly GroupReferenceNode[]): string | undefined {
  const references = new Map<string, readonly string[]>()
  for (const node of nodes) {
    if (references.has(node.id)) return `duplicate group id in reference graph: ${node.id}`
    references.set(node.id, node.groupIds)
  }

  for (const [id, groupIds] of references) {
    for (const childId of groupIds) {
      if (!references.has(childId)) return `group ${id} references a missing group: ${childId}`
    }
  }

  const state = new Map<string, 0 | 1 | 2>()
  for (const startId of references.keys()) {
    if (state.get(startId) === 2) continue

    const stack: Array<{ id: string; nextChild: number }> = [{ id: startId, nextChild: 0 }]
    state.set(startId, 1)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const children = references.get(frame.id) ?? []
      if (frame.nextChild >= children.length) {
        state.set(frame.id, 2)
        stack.pop()
        continue
      }

      const childId = children[frame.nextChild]!
      frame.nextChild += 1
      const childState = state.get(childId) ?? 0
      if (childState === 2) continue
      if (childState === 1) {
        const cycleStart = stack.findIndex(item => item.id === childId)
        const cycle = stack.slice(cycleStart).map(item => item.id)
        cycle.push(childId)
        return `group reference cycle detected: ${cycle.join(' -> ')}`
      }

      state.set(childId, 1)
      stack.push({ id: childId, nextChild: 0 })
    }
  }

  return undefined
}
