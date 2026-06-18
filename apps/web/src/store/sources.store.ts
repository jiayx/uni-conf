import { create } from 'zustand'
import type { ProxySource, SourceRefreshResult } from '@uni-conf/types'
import { api } from '@/lib/api'

interface SourcesState {
  sources: ProxySource[]
  loading: boolean
  error: string | null
  fetchSources: () => Promise<void>
  addSource: (data: Omit<ProxySource, 'id' | 'nodeCount' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateSource: (id: string, data: Partial<ProxySource>) => Promise<void>
  deleteSource: (id: string) => Promise<void>
  refreshSource: (id: string) => Promise<SourceRefreshResult>
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  sources: [],
  loading: false,
  error: null,

  fetchSources: async () => {
    set({ loading: true, error: null })
    try {
      const sources = await api.sources.list()
      set({ sources, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  addSource: async (data) => {
    const source = await api.sources.create(data)
    set(s => ({ sources: [...s.sources, source] }))
  },

  updateSource: async (id, data) => {
    const updated = await api.sources.update(id, data)
    set(s => ({ sources: s.sources.map(src => (src.id === id ? updated : src)) }))
  },

  deleteSource: async (id) => {
    await api.sources.remove(id)
    set(s => ({ sources: s.sources.filter(src => src.id !== id) }))
  },

  refreshSource: async (id) => {
    const result = await api.sources.refresh(id)
    if (result.success) {
      // Update node count
      await get().fetchSources()
    }
    return result
  },
}))
