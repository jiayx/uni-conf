import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { NodeCollection, ProxyGroup, ProxyNode, ProxyRule, ProxySource } from '@uni-conf/types'
import { api } from '@/lib/api'
import { useCollectionsStore } from './collections.store'
import { useGroupsStore } from './groups.store'
import { useNodesStore } from './nodes.store'
import { useRulesStore } from './rules.store'
import { useSettingsStore } from './settings.store'
import { useSourcesStore } from './sources.store'

vi.mock('@/lib/api', () => ({
  api: {
    collections: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), preview: vi.fn() },
    groups: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() },
    nodes: { listAll: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    rules: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), batchCreate: vi.fn() },
    sources: { list: vi.fn(), create: vi.fn(), import: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() },
  },
}))

const timestamps = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const collection: NodeCollection = { id: 'c1', name: 'C1', sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'name', enabled: true, ...timestamps }
const node: ProxyNode = { id: 'n1', sourceId: 's1', name: 'N1', protocol: 'trojan', server: 'example.com', port: 443, enabled: true, tags: [], rawConfig: {}, parsedConfig: { protocol: 'trojan', server: 'example.com', port: 443, extra: {} }, isManual: true, ...timestamps }
const group: ProxyGroup = { id: 'g1', name: 'G1', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 1, isBuiltin: false, ...timestamps }
const rule: ProxyRule = { id: 'r1', type: 'DOMAIN', payload: 'example.com', targetGroupId: 'g1', enabled: true, order: 1, compatibility: [], ...timestamps }
const source: ProxySource = { id: 's1', name: 'S1', type: 'url', format: 'auto', enabled: true, nodeCount: 1, tags: [], groups: [], ...timestamps }

describe('Zustand API stores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCollectionsStore.setState({ collections: [], previews: {}, loading: false, error: null })
    useGroupsStore.setState({ groups: [], loading: false, error: null })
    useNodesStore.setState({ nodes: [], loading: false, error: null, filters: { search: '', sourceId: '', protocol: '', country: '', enabled: undefined } })
    useRulesStore.setState({ rules: [], loading: false, error: null })
    useSourcesStore.setState({ sources: [], loading: false, error: null, refreshResults: {}, refreshErrors: {} })
  })

  it('covers collection fetch, mutations, preview, and error state', async () => {
    vi.mocked(api.collections.list).mockResolvedValue([collection])
    vi.mocked(api.collections.create).mockResolvedValue(collection)
    vi.mocked(api.collections.update).mockResolvedValue({ ...collection, name: 'Updated' })
    vi.mocked(api.collections.preview).mockResolvedValue([node])
    vi.mocked(api.collections.remove).mockResolvedValue(undefined)
    const state = useCollectionsStore.getState()
    await state.fetchCollections()
    await state.addCollection(collection)
    await state.updateCollection('c1', { name: 'Updated' })
    expect(await state.previewCollection('c1')).toEqual([node])
    await state.deleteCollection('c1')
    expect(useCollectionsStore.getState().collections).toEqual([])
    vi.mocked(api.collections.list).mockRejectedValue(new Error('offline'))
    await state.fetchCollections()
    expect(useCollectionsStore.getState().error).toBe('offline')
  })

  it('covers ordered group CRUD and optimistic reordering', async () => {
    const second = { ...group, id: 'g2', name: 'G2', order: 0 }
    vi.mocked(api.groups.list).mockResolvedValue([group, second])
    vi.mocked(api.groups.create).mockResolvedValue(group)
    vi.mocked(api.groups.update).mockResolvedValue({ ...group, name: 'Updated' })
    vi.mocked(api.groups.remove).mockResolvedValue(undefined)
    vi.mocked(api.groups.reorder).mockResolvedValue([])
    const state = useGroupsStore.getState()
    await state.fetchGroups()
    expect(useGroupsStore.getState().groups[0]?.id).toBe('g2')
    await state.addGroup(group)
    await state.updateGroup('g1', { name: 'Updated' })
    await state.reorderGroups(['g1', 'g2'])
    expect(useGroupsStore.getState().groups.map((item) => item.id)).toEqual(['g1', 'g2'])
    await state.deleteGroup('g1')
  })

  it('covers node filters and CRUD', async () => {
    vi.mocked(api.nodes.listAll).mockResolvedValue([node])
    vi.mocked(api.nodes.create).mockResolvedValue(node)
    vi.mocked(api.nodes.update).mockResolvedValue({ ...node, enabled: false })
    vi.mocked(api.nodes.remove).mockResolvedValue(undefined)
    const state = useNodesStore.getState()
    state.setFilters({ search: 'N1', sourceId: 's1', protocol: 'trojan', country: 'US', enabled: true })
    state.applyFilters()
    await waitFor(() => expect(api.nodes.listAll).toHaveBeenCalledWith({ search: 'N1', sourceId: 's1', protocol: 'trojan', country: 'US', enabled: true }))
    await state.addNode(node)
    await state.updateNode('n1', { enabled: false })
    await state.deleteNode('n1')
    expect(useNodesStore.getState().nodes).toEqual([])
  })

  it('covers sorted rule CRUD, batch creation, and reordering', async () => {
    const second = { ...rule, id: 'r2', order: 0 }
    vi.mocked(api.rules.list).mockResolvedValue([rule, second])
    vi.mocked(api.rules.create).mockResolvedValue(rule)
    vi.mocked(api.rules.update).mockResolvedValue({ ...rule, payload: 'updated.example' })
    vi.mocked(api.rules.batchCreate).mockResolvedValue([second])
    vi.mocked(api.rules.reorder).mockResolvedValue([])
    vi.mocked(api.rules.remove).mockResolvedValue(undefined)
    const state = useRulesStore.getState()
    await state.fetchRules()
    await state.addRule(rule)
    await state.updateRule('r1', { payload: 'updated.example' })
    await state.batchAddRules([rule])
    await state.reorderRules(['r1', 'r2'])
    await state.deleteRule('r1')
    expect(api.rules.reorder).toHaveBeenCalledWith(['r1', 'r2'])
  })

  it('tracks source create and refresh success/error results', async () => {
    const refresh = { sourceId: 's1', success: true, nodeCount: 1, addedCount: 1, removedCount: 0 }
    vi.mocked(api.sources.list).mockResolvedValue([source])
    vi.mocked(api.sources.create).mockResolvedValue({ source, refresh })
    vi.mocked(api.sources.import).mockResolvedValue({ source, refreshError: 'parse failed' })
    vi.mocked(api.sources.update).mockResolvedValue({ ...source, name: 'Updated' })
    vi.mocked(api.sources.remove).mockResolvedValue(undefined)
    vi.mocked(api.sources.refresh).mockResolvedValue(refresh)
    const state = useSourcesStore.getState()
    await state.fetchSources()
    await state.addSource({ url: 'https://example.com/sub' })
    await state.importSource({ content: 'node' })
    await state.updateSource('s1', { name: 'Updated' })
    await state.refreshSource('s1')
    expect(useSourcesStore.getState().refreshResults.s1).toEqual(refresh)
    vi.mocked(api.sources.refresh).mockRejectedValue(new Error('offline'))
    await expect(state.refreshSource('s1')).rejects.toThrow('offline')
    expect(useSourcesStore.getState().refreshErrors.s1).toBe('offline')
    await state.deleteSource('s1')
  })
})

describe('settings store', () => {
  it('applies preferences and theme attributes', () => {
    const state = useSettingsStore.getState()
    state.setLanguage('en')
    state.setTheme('dark')
    state.setDnsMode('fake-ip')
    state.setExportNodeNamingMode('original')
    state.setShowCompatibilityWarnings(false)
    state.setEnableAutoRefresh(false)
    state.setAutoRefreshInterval(60)
    state.setAutoNodeGroupsEnabled(false)
    state.setAutoNodeGroupTypes(['select'])
    state.setAutoNodeGroupIncludeFlag(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    state.applyTheme('system')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })
})
