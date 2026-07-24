import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { ProxyNode } from '@uni-conf/types'
import i18n from '@/i18n'
import { Nodes } from './Nodes'

const stores = vi.hoisted(() => ({
  nodes: {
    nodes: [] as ProxyNode[],
    loading: false,
    error: null as unknown,
    fetchNodes: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    updateNode: vi.fn(async () => undefined),
    setNodesEnabled: vi.fn(async () => undefined),
    deleteNode: vi.fn(async () => undefined),
  },
  sources: {
    sources: [
      { id: 'source-a', name: 'Airport A' },
      { id: 'source-b', name: 'Airport B' },
    ],
    fetchSources: vi.fn(async () => undefined),
  },
}))

const apiMocks = vi.hoisted(() => ({
  getNode: vi.fn(),
}))

vi.mock('@/store/nodes.store', () => ({ useNodesStore: () => stores.nodes }))
vi.mock('@/store/sources.store', () => ({ useSourcesStore: () => stores.sources }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      nodes: {
        ...actual.api.nodes,
        get: apiMocks.getNode,
      },
    },
  }
})

describe('Nodes filters', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    await i18n.changeLanguage('en')
    stores.nodes.error = null
    stores.nodes.nodes = [
      makeNode('hong-kong', 'Hong Kong Premium', 'hk.example.com', 'source-a', 'ss', 'HK', true),
      makeNode('tokyo', 'Tokyo Backup', 'jp.example.com', 'source-b', 'trojan', 'JP', false),
      makeNode('manual', 'Home Relay', 'home.example.net', 'manual', 'socks5', 'US', true, true),
    ]
    apiMocks.getNode.mockImplementation(async (id: string) => stores.nodes.nodes.find(node => node.id === id))
  })

  it('combines source and status filters and can restore the full list', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    expect(await screen.findByText('Showing 3 of 3 nodes')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'source-b')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'disabled')

    expect(screen.getByText('Tokyo Backup')).toBeInTheDocument()
    expect(screen.queryByText('Hong Kong Premium')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 3 nodes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Hong Kong Premium')).toBeInTheDocument()
    expect(screen.getByText('Home Relay')).toBeInTheDocument()
    expect(screen.getByText('Showing 3 of 3 nodes')).toBeInTheDocument()
  })

  it('searches server and source names and explains an empty filtered result', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    const search = await screen.findByRole('textbox', { name: 'Search' })
    await user.type(search, 'home.example.net')
    expect(screen.getByText('Home Relay')).toBeInTheDocument()
    expect(screen.queryByText('Tokyo Backup')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Airport A')
    expect(screen.getByText('Hong Kong Premium')).toBeInTheDocument()
    expect(screen.queryByText('Home Relay')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'does-not-exist')
    expect(screen.getByRole('heading', { name: 'No matching nodes' })).toBeInTheDocument()
    expect(screen.getByText('Try another name, server, source, protocol, region, or status.')).toBeInTheDocument()
  })

  it('selects the current filtered result and applies one batch enable update', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Country/Region' }), 'HK')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible nodes' }))

    expect(screen.getByText('Selected nodes: 1')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Hong Kong Premium' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Disable selected' }))

    expect(stores.nodes.setNodesEnabled).toHaveBeenCalledWith(['hong-kong'], false)
    expect(screen.queryByText('Selected nodes: 1')).not.toBeInTheDocument()
  })

  it('keeps edit context while detail loading and hides the create-only URI field', async () => {
    let resolveNode!: (node: ProxyNode) => void
    apiMocks.getNode.mockImplementationOnce(() => new Promise<ProxyNode>(resolve => { resolveNode = resolve }))
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    expect(screen.getByRole('dialog', { name: 'Edit Manual Node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('textbox', { name: 'Node URI' })).not.toBeInTheDocument()

    resolveNode(stores.nodes.nodes[0]!)
    expect(await screen.findByDisplayValue('Hong Kong Premium')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('keeps the editor open and reports detail or save failures', async () => {
    apiMocks.getNode.mockRejectedValueOnce(new Error('detail unavailable'))
    const user = userEvent.setup()
    const { unmount } = render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('detail unavailable')
    expect(screen.getByRole('dialog', { name: 'Edit Manual Node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    unmount()
    stores.nodes.updateNode.mockRejectedValueOnce(new Error('save failed'))
    apiMocks.getNode.mockResolvedValueOnce(stores.nodes.nodes[2]!)
    render(<MemoryRouter><Nodes /></MemoryRouter>)
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[2]!)
    await screen.findByDisplayValue('Home Relay')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('save failed')
    expect(screen.getByRole('dialog', { name: 'Edit Manual Node' })).toBeInTheDocument()
  })

  it('reports row failures and exposes a named delete action', async () => {
    stores.nodes.updateNode.mockRejectedValueOnce(new Error('toggle failed'))
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Disable' }))[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('toggle failed')
    expect(screen.getByRole('button', { name: 'Delete Home Relay' })).toBeInTheDocument()
  })

  it('keeps a changed manual node form open when discard is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Manual Entry' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Draft Node')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(screen.getByRole('dialog', { name: 'Manual Entry' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Draft Node')
    confirmSpy.mockRestore()
  })
})

function makeNode(
  id: string,
  name: string,
  server: string,
  sourceId: string,
  protocol: ProxyNode['protocol'],
  countryCode: string,
  enabled: boolean,
  isManual = false,
): ProxyNode {
  return {
    id,
    sourceId,
    name,
    protocol,
    server,
    port: 443,
    country: countryCode,
    countryCode,
    enabled,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol, server, port: 443, extra: {} },
    isManual,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
}
