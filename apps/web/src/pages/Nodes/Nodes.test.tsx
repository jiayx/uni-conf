import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
      { id: 'source-a', name: 'Airport A', enabled: true },
      { id: 'source-b', name: 'Airport B', enabled: true },
    ],
    fetchSources: vi.fn(async () => undefined),
  },
}))

const apiMocks = vi.hoisted(() => ({
  getNode: vi.fn(),
  getNodeUri: vi.fn(),
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
        getUri: apiMocks.getNodeUri,
      },
    },
  }
})

describe('Nodes filters', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    await i18n.changeLanguage('en')
    stores.nodes.error = null
    stores.sources.sources[0]!.enabled = true
    stores.sources.sources[1]!.enabled = true
    stores.nodes.nodes = [
      makeNode('hong-kong', 'Hong Kong Premium', 'hk.example.com', 'source-a', 'ss', 'HK', true),
      makeNode('tokyo', 'Tokyo Backup', 'jp.example.com', 'source-b', 'trojan', 'JP', false),
      makeNode('manual', 'Home Relay', 'home.example.net', 'manual', 'socks5', 'US', true, true),
    ]
    apiMocks.getNode.mockImplementation(async (id: string) => stores.nodes.nodes.find(node => node.id === id))
    apiMocks.getNodeUri.mockImplementation(async (id: string) => ({ uri: `ss://standard-${id}` }))
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

  it('keeps effectively disabled nodes after enabled nodes', async () => {
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    const names = (await screen.findAllByRole('row'))
      .slice(1)
      .map(row => within(row).getAllByRole('cell')[1]?.textContent)

    expect(names).toEqual(['Hong Kong Premium', 'Home Relay', 'Tokyo Backup'])
  })

  it('places edit and delete before the right-aligned state and copy actions', async () => {
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    const manualRow = (await screen.findByText('Home Relay')).closest('tr')!
    expect(within(manualRow).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Edit',
      'Delete',
      'Disable',
      'Copy',
    ])

    const subscriptionRow = screen.getByText('Hong Kong Premium').closest('tr')!
    expect(within(subscriptionRow).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Disable',
      'Copy',
    ])
  })

  it('shows a source-level disabled status without changing the node state', async () => {
    stores.sources.sources[0]!.enabled = false
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    const sourceDisabledRow = (await screen.findByText('Hong Kong Premium')).closest('tr')!
    expect(within(sourceDisabledRow).getByText('Subscription paused')).toBeInTheDocument()
    expect(within(sourceDisabledRow).getByRole('button', { name: 'Disable' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'enabled')
    expect(screen.queryByText('Hong Kong Premium')).not.toBeInTheDocument()
    expect(screen.getByText('Home Relay')).toBeInTheDocument()
  })

  it('copies the standard share URI for subscription and manual nodes', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    const subscriptionRow = (await screen.findByText('Hong Kong Premium')).closest('tr')!
    await user.click(within(subscriptionRow).getByRole('button', { name: 'Copy node URI for Hong Kong Premium' }))

    expect(apiMocks.getNodeUri).toHaveBeenCalledWith('hong-kong')
    expect(writeText).toHaveBeenCalledWith('ss://standard-hong-kong')
    expect(within(subscriptionRow).getByRole('button', { name: 'Node URI copied for Hong Kong Premium' })).toHaveTextContent('Copied!')

    const manualRow = screen.getByText('Home Relay').closest('tr')!
    expect(within(manualRow).getByRole('button', { name: 'Copy node URI for Home Relay' })).toBeInTheDocument()
  })

  it('reports clipboard permission failures', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Copy node URI for Hong Kong Premium' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy to the clipboard')
  })

  it('opens manual entry directly from the dashboard setup link', async () => {
    render(<MemoryRouter initialEntries={['/nodes?create=1']}><Nodes /></MemoryRouter>)

    const dialog = await screen.findByRole('dialog', { name: 'Manual Entry' })
    expect(within(dialog).getByRole('textbox', { name: 'Node URI' })).toBeInTheDocument()
    expect(within(dialog).getByText(/detect its protocol and connection settings/)).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Common protocols' })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Other protocols' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Protocol' })).toHaveValue('ss')
  })

  it('detects the country from a manual node name and allows one-field override', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/nodes?create=1']}><Nodes /></MemoryRouter>)

    const dialog = await screen.findByRole('dialog', { name: 'Manual Entry' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '🇩🇪 Frankfurt Premium')
    await user.type(within(dialog).getByRole('textbox', { name: 'Server' }), 'de.example.com')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Protocol' }), 'socks5')

    const country = within(dialog).getByRole('combobox', { name: 'Country/Region' })
    expect(country).toHaveValue('')
    expect(within(country).getByRole('option', { name: 'Auto-detect: Germany (DE)' })).toBeInTheDocument()

    await user.selectOptions(country, 'JP')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(stores.nodes.addNode).toHaveBeenCalledWith(expect.objectContaining({
      name: '🇩🇪 Frankfurt Premium',
      country: 'Japan',
      countryCode: 'JP',
    }))
  })

  it('saves the country detected from a manual node name', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/nodes?create=1']}><Nodes /></MemoryRouter>)

    const dialog = await screen.findByRole('dialog', { name: 'Manual Entry' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Singapore Edge')
    await user.type(within(dialog).getByRole('textbox', { name: 'Server' }), 'sg.example.com')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Protocol' }), 'socks5')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(stores.nodes.addNode).toHaveBeenCalledWith(expect.objectContaining({
      country: 'Singapore',
      countryCode: 'SG',
    }))
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

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit Manual Node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('textbox', { name: 'Node URI' })).not.toBeInTheDocument()

    resolveNode(stores.nodes.nodes[2]!)
    expect(await screen.findByDisplayValue('Home Relay')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('reveals node secrets on demand without enabling password-manager autofill', async () => {
    const manualNode = stores.nodes.nodes[2]!
    apiMocks.getNode.mockResolvedValueOnce({
      ...manualNode,
      rawConfig: { password: 'node-secret' },
      parsedConfig: {
        ...manualNode.parsedConfig,
        password: 'node-secret',
      },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const password = await screen.findByLabelText('Password')
    const reveal = screen.getByRole('button', { name: 'Show Password' })

    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'off')
    expect(password).toHaveAttribute('data-1p-ignore', 'true')
    expect(password).toHaveAttribute('data-bwignore', 'true')
    expect(password).toHaveAttribute('data-lpignore', 'true')
    expect(password).not.toHaveAttribute('name')

    await user.click(reveal)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide Password' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows and saves the AnyTLS UDP relay setting when editing', async () => {
    const anytlsNode = makeNode('anytls-manual', 'AnyTLS Relay', 'anytls.example.com', 'manual', 'anytls', 'HK', true, true)
    anytlsNode.rawConfig = { password: 'secret', udp: false }
    anytlsNode.parsedConfig = {
      protocol: 'anytls',
      server: anytlsNode.server,
      port: anytlsNode.port,
      password: 'secret',
      tls: true,
      extra: { udp: false },
    }
    stores.nodes.nodes = [anytlsNode]
    apiMocks.getNode.mockResolvedValue(anytlsNode)
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const authentication = await screen.findByRole('group', { name: 'Authentication' })
    const tlsIdentity = screen.getByRole('group', { name: 'TLS identity' })
    const connectionOptions = screen.getByRole('group', { name: 'Connection options' })
    expect(within(authentication).getByLabelText('Password *')).toBeInTheDocument()
    expect(within(tlsIdentity).getByLabelText('SNI')).toBeInTheDocument()
    expect(within(tlsIdentity).getByLabelText('Client Fingerprint')).toBeInTheDocument()
    expect(within(tlsIdentity).getByLabelText('ALPN')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'TLS' })).not.toBeInTheDocument()

    const udpRelay = within(connectionOptions).getByRole('checkbox', { name: 'UDP Relay' })
    expect(within(connectionOptions).getByRole('checkbox', { name: 'Skip Cert Verify' })).toBeInTheDocument()
    expect(udpRelay).not.toBeChecked()

    await user.click(udpRelay)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(stores.nodes.updateNode).toHaveBeenCalledWith('anytls-manual', expect.objectContaining({
      parsedConfig: expect.objectContaining({
        extra: expect.objectContaining({ udp: true }),
      }),
    }))
  })

  it('keeps the editor open and reports detail or save failures', async () => {
    apiMocks.getNode.mockRejectedValueOnce(new Error('detail unavailable'))
    const user = userEvent.setup()
    const { unmount } = render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('detail unavailable')
    expect(screen.getByRole('dialog', { name: 'Edit Manual Node' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    unmount()
    stores.nodes.updateNode.mockRejectedValueOnce(new Error('save failed'))
    apiMocks.getNode.mockResolvedValueOnce(stores.nodes.nodes[2]!)
    render(<MemoryRouter><Nodes /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
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
    const user = userEvent.setup()
    render(<MemoryRouter><Nodes /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Manual Entry' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Draft Node')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    const editor = screen.getByRole('dialog', { name: 'Manual Entry' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(editor).getByRole('alert')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Draft Node')
    await user.click(within(editor).getByRole('button', { name: 'Continue editing' }))
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
