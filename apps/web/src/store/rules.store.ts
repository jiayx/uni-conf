import { create } from 'zustand'
import type { ProxyRule } from '@uni-conf/types'
import { api } from '@/lib/api'

interface RulesState {
  rules: ProxyRule[]
  loading: boolean
  error: string | null
  fetchRules: () => Promise<void>
  addRule: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateRule: (id: string, data: Partial<ProxyRule>) => Promise<void>
  deleteRule: (id: string) => Promise<void>
  reorderRules: (orderedIds: string[]) => Promise<void>
  batchAddRules: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<void>
}

export const useRulesStore = create<RulesState>((set) => ({
  rules: [],
  loading: false,
  error: null,

  fetchRules: async () => {
    set({ loading: true, error: null })
    try {
      const rules = await api.rules.list()
      set({ rules: rules.sort((a, b) => a.order - b.order), loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  addRule: async (data) => {
    const rule = await api.rules.create(data)
    set(s => ({ rules: [...s.rules, rule].sort((a, b) => a.order - b.order) }))
  },

  updateRule: async (id, data) => {
    const updated = await api.rules.update(id, data)
    set(s => ({ rules: s.rules.map(r => (r.id === id ? updated : r)) }))
  },

  deleteRule: async (id) => {
    await api.rules.remove(id)
    set(s => ({ rules: s.rules.filter(r => r.id !== id) }))
  },

  reorderRules: async (orderedIds) => {
    set(s => {
      const map = new Map(s.rules.map(r => [r.id, r]))
      const reordered = orderedIds
        .map((id, idx) => {
          const r = map.get(id)
          return r ? { ...r, order: idx } : null
        })
        .filter(Boolean) as ProxyRule[]
      return { rules: reordered }
    })
    await api.rules.reorder(orderedIds)
  },

  batchAddRules: async (data) => {
    const rules = await api.rules.batchCreate(data)
    set(s => ({
      rules: [...s.rules, ...rules].sort((a, b) => a.order - b.order),
    }))
  },
}))
