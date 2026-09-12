import { create } from 'zustand'
import type { ProxyNode } from '@uni-conf/types'
import { api } from '@/lib/api'
import type { NodeCreateInput, NodeListParams } from '@/lib/api'

interface NodesState {
  nodes: ProxyNode[]
  loading: boolean
  error: unknown | null
  fetchNodes: (params?: NodeListParams) => Promise<void>
  addNode: (data: NodeCreateInput) => Promise<void>
  updateNode: (id: string, data: Partial<ProxyNode>) => Promise<void>
  setNodesEnabled: (ids: string[], enabled: boolean) => Promise<void>
  deleteNode: (id: string) => Promise<void>
}

export const useNodesStore = create<NodesState>((set) => ({
  nodes: [],
  loading: false,
  error: null,

  fetchNodes: async (params) => {
    set({ loading: true, error: null })
    try {
      const nodes = await api.nodes.listAll(params)
      set({ nodes, loading: false })
    } catch (e) {
      set({ error: e, loading: false })
    }
  },

  addNode: async (data) => {
    const node = await api.nodes.create(data)
    set(s => ({ nodes: [...s.nodes, node] }))
  },

  updateNode: async (id, data) => {
    const updated = await api.nodes.update(id, data)
    set(s => ({ nodes: s.nodes.map(n => (n.id === id ? updated : n)) }))
  },

  setNodesEnabled: async (ids, enabled) => {
    const result = await api.nodes.setEnabled(ids, enabled)
    const updatedIds = new Set(result.ids)
    set(s => ({
      nodes: s.nodes.map(node => updatedIds.has(node.id) ? { ...node, enabled: result.enabled } : node),
    }))
  },

  deleteNode: async (id) => {
    await api.nodes.remove(id)
    set(s => ({ nodes: s.nodes.filter(n => n.id !== id) }))
  },
}))
