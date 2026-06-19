import { create } from 'zustand'
import type { ProxySource, SourceRefreshResult } from '@uni-conf/types'
import { api } from '@/lib/api'

interface SourcesState {
  sources: ProxySource[]
  loading: boolean
  error: string | null
  refreshResults: Record<string, SourceRefreshResult>
  refreshErrors: Record<string, string>
  fetchSources: () => Promise<void>
  addSource: (data: Omit<ProxySource, 'id' | 'nodeCount' | 'groups' | 'rawContent' | 'createdAt' | 'updatedAt'>) => Promise<ProxySource>
  updateSource: (id: string, data: Partial<ProxySource>) => Promise<void>
  deleteSource: (id: string) => Promise<void>
  refreshSource: (id: string) => Promise<SourceRefreshResult>
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  sources: [],
  loading: false,
  error: null,
  refreshResults: {},
  refreshErrors: {},

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
    return source
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
    try {
      const result = await api.sources.refresh(id)
      set(s => {
        const newErrors = { ...s.refreshErrors }
        delete newErrors[id] // Remove error on success
        return {
          refreshResults: { ...s.refreshResults, [id]: result },
          refreshErrors: newErrors,
        }
      })
      if (result.success) {
        await get().fetchSources()
      }
      return result
    } catch (e) {
      const message = (e as Error).message
      set(s => {
        const newResults = { ...s.refreshResults }
        delete newResults[id] // Remove success result on error
        return {
          refreshResults: newResults,
          refreshErrors: { ...s.refreshErrors, [id]: message },
        }
      })
      throw e
    }
  },
}))
