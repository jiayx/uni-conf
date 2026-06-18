import { create } from 'zustand'
import type { NodeCollection, ProxyNode } from '@uni-conf/types'
import { api } from '@/lib/api'

interface CollectionsState {
  collections: NodeCollection[]
  previews: Record<string, ProxyNode[]>
  loading: boolean
  error: string | null
  fetchCollections: () => Promise<void>
  addCollection: (data: Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateCollection: (id: string, data: Partial<NodeCollection>) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  previewCollection: (id: string) => Promise<ProxyNode[]>
}

export const useCollectionsStore = create<CollectionsState>((set) => ({
  collections: [],
  previews: {},
  loading: false,
  error: null,

  fetchCollections: async () => {
    set({ loading: true, error: null })
    try {
      const collections = await api.collections.list()
      set({ collections, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  addCollection: async (data) => {
    const collection = await api.collections.create(data)
    set(s => ({ collections: [...s.collections, collection] }))
  },

  updateCollection: async (id, data) => {
    const updated = await api.collections.update(id, data)
    set(s => ({ collections: s.collections.map(c => (c.id === id ? updated : c)) }))
  },

  deleteCollection: async (id) => {
    await api.collections.remove(id)
    set(s => ({ collections: s.collections.filter(c => c.id !== id) }))
  },

  previewCollection: async (id) => {
    const nodes = await api.collections.preview(id)
    set(s => ({ previews: { ...s.previews, [id]: nodes } }))
    return nodes
  },
}))
