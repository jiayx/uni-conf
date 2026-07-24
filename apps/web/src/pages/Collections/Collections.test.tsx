import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NodeCollection } from '@uni-conf/types'
import { AUTO_NODE_GROUP_PREFIX } from '@uni-conf/shared'
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

const collections: NodeCollection[] = [
  makeCollection('auto-hk', 'HK Auto', `${AUTO_NODE_GROUP_PREFIX} country:HK:url-test`),
  makeCollection('auto-jp', 'JP Auto', `${AUTO_NODE_GROUP_PREFIX} country:JP:url-test`),
  makeCollection('manual-1', 'Work Nodes'),
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

  it('loads manual groups initially but keeps automatic groups lazy until expanded', async () => {
    const user = userEvent.setup()
    render(<Collections />)

    await waitFor(() => expect(mocks.previewCollection).toHaveBeenCalledWith('manual-1'))
    expect(mocks.previewCollection).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Toggle node preview for HK Auto' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Toggle node preview for Work Nodes' })).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'Toggle node preview for HK Auto' }))
    await waitFor(() => expect(mocks.previewCollection).toHaveBeenCalledWith('auto-hk'))
    expect(mocks.previewCollection).not.toHaveBeenCalledWith('auto-jp')
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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<Collections />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Draft Work Nodes')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument()
    expect(name).toHaveValue('Draft Work Nodes')
    confirmSpy.mockRestore()
  })
})

function makeCollection(id: string, name: string, notes?: string): NodeCollection {
  return {
    id, name, sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'country',
    enabled: true, notes, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
