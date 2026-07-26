import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NodeCollectionSummary } from '@uni-conf/types'
import {
  AUTO_NODE_GROUP_PREFIX,
  DEFAULT_NODE_POOL_COLLECTION_ID,
  DEFAULT_NODE_POOL_PREFIX,
} from '@uni-conf/shared'
import i18n from '@/i18n'
import { Collections } from './Collections'

const mocks = vi.hoisted(() => ({
  fetchCollections: vi.fn(async () => undefined),
  fetchGroups: vi.fn(async () => undefined),
  fetchNodes: vi.fn(async () => undefined),
  fetchSources: vi.fn(async () => undefined),
  previewCollection: vi.fn(async () => []),
  deleteCollection: vi.fn(async () => undefined),
  updateWithGroup: vi.fn(async () => ({
    collection: { id: 'manual-1' },
    group: {},
  })),
}))

const collections: NodeCollectionSummary[] = [
  makeCollection('auto-hk', 'HK Auto', 3, `${AUTO_NODE_GROUP_PREFIX} country:HK:url-test`),
  makeCollection('auto-jp', 'JP Auto', 5, `${AUTO_NODE_GROUP_PREFIX} country:JP:url-test`),
  makeCollection(DEFAULT_NODE_POOL_COLLECTION_ID, 'Default Node Pool', 8, DEFAULT_NODE_POOL_PREFIX),
  makeCollection('manual-1', 'Work Nodes', 2),
]

vi.mock('@/store/collections.store', () => ({
  useCollectionsStore: () => ({
    collections, previews: {}, loading: false, error: null,
    fetchCollections: mocks.fetchCollections,
    deleteCollection: mocks.deleteCollection,
    previewCollection: mocks.previewCollection,
  }),
}))
vi.mock('@/store/groups.store', () => ({ useGroupsStore: () => ({ groups: [], fetchGroups: mocks.fetchGroups }) }))
vi.mock('@/store/nodes.store', () => ({ useNodesStore: () => ({ nodes: [], fetchNodes: mocks.fetchNodes }) }))
vi.mock('@/store/sources.store', () => ({ useSourcesStore: () => ({ sources: [], fetchSources: mocks.fetchSources }) }))
vi.mock('@/store/settings.store', () => ({ useSettingsStore: () => ({ applySettings: vi.fn() }) }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      collections: {
        ...actual.api.collections,
        updateWithGroup: mocks.updateWithGroup,
      },
    },
  }
})

describe('Collections node previews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
  })

  it('loads every node group preview only after expansion', async () => {
    const user = userEvent.setup()
    render(<Collections />)

    expect(mocks.previewCollection).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Toggle node preview for HK Auto' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Toggle node preview for Work Nodes' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Toggle node preview for HK Auto' })).toHaveTextContent('3 nodesExpand')

    await user.click(screen.getByRole('button', { name: 'Toggle node preview for Work Nodes' }))
    await waitFor(() => expect(mocks.previewCollection).toHaveBeenCalledWith('manual-1'))
    expect(screen.getByRole('button', { name: 'Toggle node preview for Work Nodes' })).toHaveTextContent('2 nodesCollapse')
    expect(mocks.previewCollection).not.toHaveBeenCalledWith('auto-jp')

    await user.click(screen.getByRole('button', { name: 'Toggle node preview for Default Node Pool' }))
    await waitFor(() => expect(mocks.previewCollection).toHaveBeenCalledWith(DEFAULT_NODE_POOL_COLLECTION_ID))
    expect(screen.getByRole('button', { name: 'Toggle node preview for Default Node Pool' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the edit dialog and original values available when atomic save fails', async () => {
    const user = userEvent.setup()
    mocks.updateWithGroup.mockRejectedValueOnce(new Error('atomic node group save failed'))
    render(<Collections />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Changed Work Nodes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('atomic node group save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Changed Work Nodes')
    expect(mocks.updateWithGroup).toHaveBeenCalledWith(
      'manual-1',
      expect.objectContaining({ name: 'Changed Work Nodes' }),
      'url-test',
    )
  })

  it('localizes summaries and exposes accessible names for dynamic transform controls', async () => {
    const user = userEvent.setup()
    render(<Collections />)

    expect((await screen.findAllByText('All sources')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sort: By Country').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dedup: By Name').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('group', { name: 'Specific Nodes' })).toBeInTheDocument()
    expect(screen.queryByText('指定节点')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Filter' }))
    expect(screen.getByRole('group', { name: 'Filter 1' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enable filter 1' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Field for filter 1' })).toHaveDisplayValue('Name')
    expect(screen.getByRole('combobox', { name: 'Operator for filter 1' })).toHaveDisplayValue('Contains')
    expect(screen.getByRole('textbox', { name: 'Value for filter 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Rename Rule' }))
    expect(screen.getByRole('group', { name: 'Rename rule 1' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Type for rename rule 1' })).toHaveDisplayValue('Text Replace')
    expect(screen.getByRole('textbox', { name: 'Pattern for rename rule 1' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Replacement for rename rule 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove rename rule 1' })).toBeInTheDocument()
  })

  it('preserves changed node-group fields when discard is cancelled', async () => {
    const user = userEvent.setup()
    render(<Collections />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Draft Work Nodes')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    const editor = screen.getByRole('dialog', { name: 'Edit' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(editor).getByRole('alert')).toHaveTextContent('Unsaved changes')
    expect(name).toHaveValue('Draft Work Nodes')
    await user.click(within(editor).getByRole('button', { name: 'Continue editing' }))
  })
})

function makeCollection(id: string, name: string, nodeCount: number, notes?: string): NodeCollectionSummary {
  return {
    id, name, sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'country',
    enabled: true, nodeCount, notes, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
