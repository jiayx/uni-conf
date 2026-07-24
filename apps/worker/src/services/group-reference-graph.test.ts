import { describe, expect, it } from 'vitest'
import { validateGroupReferenceGraph } from './group-reference-graph'

describe('group reference graph validation', () => {
  it('accepts a directed acyclic group graph', () => {
    expect(validateGroupReferenceGraph([
      { id: 'root', groupIds: ['primary', 'fallback'] },
      { id: 'primary', groupIds: ['leaf'] },
      { id: 'fallback', groupIds: ['leaf'] },
      { id: 'leaf', groupIds: [] },
    ])).toBeUndefined()
  })

  it('rejects direct and indirect cycles with an actionable path', () => {
    expect(validateGroupReferenceGraph([
      { id: 'self', groupIds: ['self'] },
    ])).toBe('group reference cycle detected: self -> self')

    expect(validateGroupReferenceGraph([
      { id: 'a', groupIds: ['b'] },
      { id: 'b', groupIds: ['c'] },
      { id: 'c', groupIds: ['a'] },
    ])).toBe('group reference cycle detected: a -> b -> c -> a')
  })

  it('rejects missing and duplicate graph nodes', () => {
    expect(validateGroupReferenceGraph([
      { id: 'a', groupIds: ['missing'] },
    ])).toBe('group a references a missing group: missing')
    expect(validateGroupReferenceGraph([
      { id: 'a', groupIds: [] },
      { id: 'a', groupIds: [] },
    ])).toBe('duplicate group id in reference graph: a')
  })

  it('handles deep graphs without recursive stack growth', () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `group-${index}`,
      groupIds: index === 9_999 ? [] : [`group-${index + 1}`],
    }))
    expect(validateGroupReferenceGraph(nodes)).toBeUndefined()
  })
})
