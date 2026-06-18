import { create } from 'zustand'
import type { ProxyGroup } from '@uni-conf/types'
import { api } from '@/lib/api'

interface GroupsState {
  groups: ProxyGroup[]
  loading: boolean
  error: string | null
  fetchGroups: () => Promise<void>
  addGroup: (data: Omit<ProxyGroup, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateGroup: (id: string, data: Partial<ProxyGroup>) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  reorderGroups: (orderedIds: string[]) => Promise<void>
}

export const useGroupsStore = create<GroupsState>((set) => ({
  groups: [],
  loading: false,
  error: null,

  fetchGroups: async () => {
    set({ loading: true, error: null })
    try {
      const groups = await api.groups.list()
      set({ groups: groups.sort((a, b) => a.order - b.order), loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  addGroup: async (data) => {
    const group = await api.groups.create(data)
    set(s => ({ groups: [...s.groups, group] }))
  },

  updateGroup: async (id, data) => {
    const updated = await api.groups.update(id, data)
    set(s => ({ groups: s.groups.map(g => (g.id === id ? updated : g)) }))
  },

  deleteGroup: async (id) => {
    await api.groups.remove(id)
    set(s => ({ groups: s.groups.filter(g => g.id !== id) }))
  },

  reorderGroups: async (orderedIds) => {
    // Optimistically update
    set(s => {
      const map = new Map(s.groups.map(g => [g.id, g]))
      const reordered = orderedIds
        .map((id, idx) => {
          const g = map.get(id)
          return g ? { ...g, order: idx } : null
        })
        .filter(Boolean) as ProxyGroup[]
      return { groups: reordered }
    })
    await api.groups.reorder(orderedIds)
  },
}))
