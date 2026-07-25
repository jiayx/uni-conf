import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Sources } from './Sources'
import { api, ApiError } from '@/lib/api'
import i18n from '@/i18n'
import { MAX_SOURCE_CONTENT_BYTES } from '@uni-conf/shared'
import type { ProxySource } from '@uni-conf/types'

const store = vi.hoisted(() => ({
  sources: [] as ProxySource[],
  error: null as unknown | null,
  fetchSources: vi.fn(async () => undefined),
  addSource: vi.fn(),
  importSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  refreshSource: vi.fn(),
}))

vi.mock('@/store/sources.store', () => ({
  useSourcesStore: () => ({
    sources: store.sources, loading: false, error: store.error, refreshResults: {}, refreshErrors: {},
    fetchSources: store.fetchSources,
    addSource: store.addSource,
    importSource: store.importSource,
    updateSource: store.updateSource,
    deleteSource: store.deleteSource,
    refreshSource: store.refreshSource,
  }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      sources: {
        ...actual.api.sources,
        previewImport: vi.fn(),
        listImports: vi.fn(),
        previewNodeRetry: vi.fn(),
        retryNodeImport: vi.fn(),
        previewStructuredRetry: vi.fn(),
        retryStructuredImport: vi.fn(),
        undoImport: vi.fn(),
      },
    },
  }
})

describe('Sources import flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.sources = []
    store.error = null
    void i18n.changeLanguage('en')
    vi.mocked(api.sources.listImports).mockResolvedValue([])
  })

  it('only enables source creation after detecting a valid subscription URL', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    const addButtons = screen.getAllByRole('button', { name: 'Add URL' })
    await user.click(addButtons[0]!)

    const input = screen.getByRole('textbox', { name: 'Subscription URL' })
    const submit = screen.getByRole('button', { name: 'Save and Generate' })
    expect(submit).toBeDisabled()

    await user.type(input, 'not a subscription')
    expect(submit).toBeDisabled()

    await user.type(input, '\nhttps://example.com/sub')
    expect(submit).toBeEnabled()
  })

  it('previews a config before committing the import', async () => {
    vi.mocked(api.sources.previewImport).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 1, excludedCount: 0, sourceGroupCount: 1,
      groups: [{ name: 'Auto', memberNames: ['HK 01'] }],
      nodes: [{ name: 'HK 01', protocol: 'trojan', server: 'hk.example.com', port: 443, tags: [] }],
      importedObjects: ['nodes', 'source-groups'],
      preservedOnly: ['rules', 'remote-rule-sets', 'dns', 'client-settings'],
      structured: {
        rules: 0, remoteRuleSets: 0, skippedRules: 1,
        duplicateRules: 2, duplicateRemoteRuleSets: 1, unmappedTargets: ['MISSING'],
        conflictingRules: 1, conflictingRemoteRuleSets: 1,
        hasDns: true, clientSettingKeys: [],
      },
      diff: {
        nodes: { total: 1, truncated: false, counts: { new: 1, duplicate: 0, conflict: 0, unmapped: 0 }, items: [{ key: 'node-1', label: 'HK 01', status: 'new', changes: [] }] },
        rules: { total: 1, truncated: false, counts: { new: 0, duplicate: 0, conflict: 1, unmapped: 0 }, items: [{ key: 'rule:0:DOMAIN|example.com|0', label: 'DOMAIN,example.com', status: 'conflict', target: 'PROXY', resolvable: true, changes: [{ field: 'target', before: 'DIRECT', after: 'PROXY' }] }] },
        remoteRuleSets: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
      },
    })
    store.importSource.mockResolvedValue({
      source: { id: 's1' }, refresh: { success: true },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Import Config' }))
    await user.type(screen.getByPlaceholderText(/Paste Clash\/Mihomo YAML/), `proxies:\n  - name: HK 01`)
    await user.click(screen.getByRole('button', { name: 'Preview Import' }))

    expect(await screen.findByText('Import Preview')).toBeInTheDocument()
    expect(screen.getByText(/1 nodes and 1 upstream groups/)).toBeInTheDocument()
    expect(screen.getByText(/2 duplicate rules and 1 duplicate remote rule sets/)).toBeInTheDocument()
    expect(screen.getByText(/1 rule conflicts and 1 remote rule-set conflicts/)).toBeInTheDocument()
    expect(screen.getByText(/Unmapped targets.*MISSING/)).toBeInTheDocument()
    expect(screen.getByText('DOMAIN,example.com')).toBeInTheDocument()
    expect(screen.getByText(/Target: DIRECT → PROXY/)).toBeInTheDocument()
    expect(store.importSource).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('Conflict handling'), 'use-imported')
    await user.click(screen.getByRole('checkbox', { name: /Only import nodes marked New/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm Import' }))
    expect(store.importSource).toHaveBeenCalledOnce()
    expect(store.importSource).toHaveBeenCalledWith(expect.objectContaining({
      importStructured: true,
      nodeImportMode: 'new-only',
      structuredConflictResolutions: { 'rule:0:DOMAIN|example.com|0': 'use-imported' },
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Configuration imported successfully.')
  })

  it('reports toggle failures without changing the visible source state', async () => {
    store.sources = [makeSource()]
    store.updateSource.mockRejectedValueOnce(new ApiError('source update failed', 409, 'source_conflict', 'request-source-1'))
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Disable Airport' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('source update failed')
    expect(alert).toHaveTextContent('source_conflict · request-source-1')
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(store.updateSource).toHaveBeenCalledWith('source-1', { enabled: false })
  })

  it('presents an imported config as a managed local source', async () => {
    store.sources = [{
      ...makeSource(),
      id: 'imported-1',
      name: 'Imported Profile',
      type: 'clipboard',
      url: undefined,
      format: 'mihomo',
    }]
    render(<MemoryRouter><Sources /></MemoryRouter>)

    expect(await screen.findByText('Imported Profile')).toBeInTheDocument()
    expect(screen.getByText('Imported config')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Imported Profile' })).toBeInTheDocument()
  })

  it('opens a URL-addressable refresh-failure view and can return to all sources', async () => {
    store.sources = [
      makeSource(),
      {
        ...makeSource(),
        id: 'source-failed',
        name: 'Failed Airport',
        lastRefreshError: 'upstream timeout',
      },
    ]
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/sources?attention=refresh']}>
        <Sources />
      </MemoryRouter>,
    )

    expect(screen.getByText('Showing refresh failures')).toBeInTheDocument()
    expect(screen.getByText('Subscription sources needing attention: 1.')).toBeInTheDocument()
    expect(screen.getByText('Failed Airport')).toBeInTheDocument()
    expect(screen.queryByText('Airport')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all sources' }))

    expect(screen.getByText('Airport')).toBeInTheDocument()
    expect(screen.getByText('Failed Airport')).toBeInTheDocument()
    expect(screen.queryByText('Showing refresh failures')).not.toBeInTheDocument()
  })

  it('explains when a deep-linked refresh-failure view has no remaining issues', async () => {
    store.sources = [makeSource()]
    render(
      <MemoryRouter initialEntries={['/sources?attention=refresh']}>
        <Sources />
      </MemoryRouter>,
    )

    expect(await screen.findByText('No refresh failures')).toBeInTheDocument()
    expect(screen.getByText('All current subscription sources are free of stored refresh errors.')).toBeInTheDocument()
  })

  it('keeps source fields available when editing fails', async () => {
    store.sources = [makeSource()]
    store.updateSource.mockRejectedValueOnce(new Error('could not save source'))
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'Delete Airport' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Airport' }))
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'User-Agent' })).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Subscription URL' }))
    await user.type(screen.getByRole('textbox', { name: 'Subscription URL' }), 'https://new.example/sub')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not save source')
    expect(screen.getByRole('dialog', { name: 'Edit - Airport' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Subscription URL' })).toHaveValue('https://new.example/sub')
  })

  it('protects edited subscription fields from an accidental close', async () => {
    store.sources = [makeSource()]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Edit Airport' }))
    const url = screen.getByRole('textbox', { name: 'Subscription URL' })
    await user.clear(url)
    await user.type(url, 'https://new.example/sub')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(screen.getByRole('dialog', { name: 'Edit - Airport' })).toBeInTheDocument()
    expect(url).toHaveValue('https://new.example/sub')
    confirmSpy.mockRestore()
  })

  it('keeps a partial-import warning visible after closing the modal', async () => {
    vi.mocked(api.sources.previewImport).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 1, excludedCount: 0, sourceGroupCount: 0,
      groups: [], nodes: [{ name: 'Node', protocol: 'trojan', server: 'node.example.com', port: 443, tags: [] }],
      importedObjects: ['nodes'], preservedOnly: [],
      structured: {
        rules: 0, remoteRuleSets: 0, skippedRules: 0, duplicateRules: 0, duplicateRemoteRuleSets: 0,
        conflictingRules: 0, conflictingRemoteRuleSets: 0, unmappedTargets: [], hasDns: false, clientSettingKeys: [],
      },
      diff: {
        nodes: { total: 1, truncated: false, counts: { new: 1, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
        rules: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
        remoteRuleSets: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
      },
    })
    store.importSource.mockResolvedValue({
      source: { id: 's1' },
      refresh: { success: true },
      structuredImportError: 'simulated D1 batch failure',
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Import Config' }))
    await user.type(screen.getByPlaceholderText(/Paste Clash\/Mihomo YAML/), 'proxies:\n  - name: Node')
    await user.click(screen.getByRole('button', { name: 'Preview Import' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm Import' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nodes were imported, but rules and remote rule sets could not be imported: simulated D1 batch failure'
    )
  })

  it('imports a rules-only config without offering node-specific options', async () => {
    vi.mocked(api.sources.previewImport).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 0, excludedCount: 0, sourceGroupCount: 0,
      groups: [], nodes: [], importedObjects: ['rules', 'remote-rule-sets'], preservedOnly: [],
      structured: {
        rules: 1, remoteRuleSets: 1, skippedRules: 0, duplicateRules: 0, duplicateRemoteRuleSets: 0,
        conflictingRules: 0, conflictingRemoteRuleSets: 0, unmappedTargets: [], hasDns: false, clientSettingKeys: [],
      },
      diff: {
        nodes: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
        rules: {
          total: 1, truncated: false, counts: { new: 1, duplicate: 0, conflict: 0, unmapped: 0 },
          items: [{ key: 'rule:0:DOMAIN-SUFFIX|example.com|0', label: 'DOMAIN-SUFFIX,example.com', status: 'new', target: 'PROXY', changes: [] }],
        },
        remoteRuleSets: {
          total: 1, truncated: false, counts: { new: 1, duplicate: 0, conflict: 0, unmapped: 0 },
          items: [{ key: 'remote-rule-set:0:https://rules.example.com/list.yaml', label: 'list', status: 'new', target: 'REJECT', changes: [] }],
        },
      },
    })
    store.importSource.mockResolvedValue({ source: { id: 'rules-source' }, refresh: { success: true, nodeCount: 0 } })
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Import Config' }))
    await user.type(screen.getByPlaceholderText(/Paste Clash\/Mihomo YAML/), 'rules:\n  - DOMAIN-SUFFIX,example.com,PROXY')
    await user.click(screen.getByRole('button', { name: 'Preview Import' }))

    expect(await screen.findByText(/Detected a mihomo rules-only config/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Only import nodes marked New/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm Import' }))
    expect(store.importSource).toHaveBeenCalledWith(expect.objectContaining({ importStructured: true }))
    expect(await screen.findByRole('status')).toHaveTextContent('Configuration imported successfully.')
  })

  it('rejects an oversized uploaded config before reading the file', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Import Config' }))
    const text = vi.fn(async () => 'must not be read')
    const oversizedFile = { name: 'huge.yaml', size: MAX_SOURCE_CONTENT_BYTES + 1, text } as unknown as File
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(input, { target: { files: [oversizedFile] } })

    expect(await screen.findByText('Config content must not exceed 4 MiB.')).toBeInTheDocument()
    expect(text).not.toHaveBeenCalled()
    expect(api.sources.previewImport).not.toHaveBeenCalled()
  })

  it('lists non-sensitive import history and can undo an active import', async () => {
    const activeRun = {
      id: 'run-1', sourceId: 'source-1', sourceName: 'Imported Config', format: 'mihomo' as const,
      nodeImportMode: 'all' as const, status: 'success' as const, nodeCount: 2, addedCount: 2,
      updatedCount: 0, skippedExistingCount: 0, ruleCount: 1, remoteRuleSetCount: 1,
      skippedRuleCount: 0, conflictCount: 0, createdAt: '2026-07-14T00:00:00.000Z',
      completedAt: '2026-07-14T00:00:01.000Z', canUndo: true,
    }
    vi.mocked(api.sources.listImports).mockResolvedValue([activeRun])
    vi.mocked(api.sources.undoImport).mockResolvedValue({
      ...activeRun, sourceId: undefined, status: 'undone', undoneAt: '2026-07-14T00:01:00.000Z', canUndo: false,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(await screen.findByText('Import history (1)'))
    expect(screen.getByText('2 nodes · 1 rules · 1 rule sets')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo import' }))

    expect(api.sources.undoImport).toHaveBeenCalledWith('run-1')
    expect(await screen.findByText('Undone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo import' })).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Import undone successfully.')
  })

  it('re-previews and retries only a failed structured import phase', async () => {
    const partialRun = {
      id: 'run-partial', sourceId: 'source-1', sourceName: 'Imported Config', format: 'mihomo' as const,
      nodeImportMode: 'all' as const, status: 'partial' as const, nodeCount: 2, addedCount: 2,
      updatedCount: 0, skippedExistingCount: 0, ruleCount: 0, remoteRuleSetCount: 0,
      skippedRuleCount: 1, conflictCount: 2, structuredError: 'Structured rule import failed',
      createdAt: '2026-07-14T00:00:00.000Z', completedAt: '2026-07-14T00:00:01.000Z', canUndo: true,
    }
    vi.mocked(api.sources.listImports).mockResolvedValue([partialRun])
    vi.mocked(api.sources.previewStructuredRetry).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 2, excludedCount: 0, sourceGroupCount: 0,
      groups: [], nodes: [], importedObjects: ['nodes'], preservedOnly: ['rules'],
      structured: {
        rules: 0, remoteRuleSets: 0, skippedRules: 0, duplicateRules: 0, duplicateRemoteRuleSets: 0,
        conflictingRules: 1, conflictingRemoteRuleSets: 0, unmappedTargets: [], hasDns: false, clientSettingKeys: [],
      },
      diff: {
        nodes: { total: 2, truncated: false, counts: { new: 0, duplicate: 2, conflict: 0, unmapped: 0 }, items: [] },
        rules: {
          total: 1, truncated: false, counts: { new: 0, duplicate: 0, conflict: 1, unmapped: 0 },
          items: [{
            key: 'rule:0:DOMAIN|example.com|0', label: 'DOMAIN,example.com', status: 'conflict',
            target: 'PROXY', resolvable: true, changes: [{ field: 'target', before: 'DIRECT', after: 'PROXY' }],
          }],
        },
        remoteRuleSets: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
      },
    })
    vi.mocked(api.sources.retryStructuredImport).mockResolvedValue({
      importRun: { ...partialRun, status: 'success', structuredError: undefined, ruleCount: 1 },
      structuredImport: {
        rules: 1, remoteRuleSets: 0, skippedRules: 0, duplicateRules: 0,
        duplicateRemoteRuleSets: 0, conflictingRules: 0, conflictingRemoteRuleSets: 0, unmappedTargets: [],
      },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(await screen.findByText('Import history (1)'))
    expect(screen.getByText('Skipped: 0 existing nodes · 1 rules')).toBeInTheDocument()
    expect(screen.getByText('2 conflict decisions')).toBeInTheDocument()
    expect(screen.getByText('Rule phase: Structured rule import failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry rules' }))
    expect(await screen.findByRole('dialog', { name: 'Retry Rule Import' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Paste Clash\/Mihomo YAML/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Conflict handling'), 'use-imported')
    await user.click(screen.getByRole('button', { name: 'Retry Rule Import' }))

    expect(api.sources.retryStructuredImport).toHaveBeenCalledWith('run-partial', {
      'rule:0:DOMAIN|example.com|0': 'use-imported',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Rules and remote rule sets were retried successfully.')
    expect(screen.queryByRole('button', { name: 'Retry rules' })).not.toBeInTheDocument()
  })

  it('re-previews and retries only a failed node import phase', async () => {
    const partialRun = {
      id: 'run-node-partial', sourceId: 'source-1', sourceName: 'Node Import', format: 'mihomo' as const,
      nodeImportMode: 'new-only' as const, status: 'partial' as const, nodeCount: 0, addedCount: 0,
      updatedCount: 0, skippedExistingCount: 0, ruleCount: 1, remoteRuleSetCount: 0,
      skippedRuleCount: 0, conflictCount: 0, refreshError: 'Node import failed',
      createdAt: '2026-07-14T00:00:00.000Z', completedAt: '2026-07-14T00:00:01.000Z', canUndo: true,
    }
    vi.mocked(api.sources.listImports).mockResolvedValue([partialRun])
    vi.mocked(api.sources.previewNodeRetry).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 2, excludedCount: 0, sourceGroupCount: 0,
      groups: [], nodes: [], importedObjects: ['nodes'], preservedOnly: [],
      structured: {
        rules: 0, remoteRuleSets: 0, skippedRules: 0, duplicateRules: 1, duplicateRemoteRuleSets: 0,
        conflictingRules: 0, conflictingRemoteRuleSets: 0, unmappedTargets: [], hasDns: false, clientSettingKeys: [],
      },
      diff: {
        nodes: {
          total: 2, truncated: false, counts: { new: 1, duplicate: 1, conflict: 0, unmapped: 0 },
          items: [
            { key: 'node:0:new', label: 'New Node', status: 'new', changes: [] },
            { key: 'node:1:existing', label: 'Existing Node', status: 'duplicate', changes: [] },
          ],
        },
        rules: { total: 1, truncated: false, counts: { new: 0, duplicate: 1, conflict: 0, unmapped: 0 }, items: [] },
        remoteRuleSets: { total: 0, truncated: false, counts: { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }, items: [] },
      },
    })
    vi.mocked(api.sources.retryNodeImport).mockResolvedValue({
      importRun: { ...partialRun, status: 'success', refreshError: undefined, nodeCount: 1, addedCount: 1, skippedExistingCount: 1 },
      refresh: {
        sourceId: 'source-1', success: true, nodeCount: 1, addedCount: 1, updatedCount: 0,
        removedCount: 0, skippedExistingCount: 1, sourceGroupCount: 0, format: 'mihomo',
      },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Sources /></MemoryRouter>)

    await user.click(await screen.findByText('Import history (1)'))
    expect(screen.getByText('Node phase: Node import failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry nodes' }))
    expect(await screen.findByRole('dialog', { name: 'Retry Node Import' })).toBeInTheDocument()
    expect(screen.getByText(/^Node changes/)).toBeInTheDocument()
    expect(screen.queryByText('Rule changes')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Paste Clash\/Mihomo YAML/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry Node Import' }))

    expect(api.sources.retryNodeImport).toHaveBeenCalledWith('run-node-partial')
    expect(store.fetchSources).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('status')).toHaveTextContent('Nodes were retried successfully.')
    expect(screen.queryByRole('button', { name: 'Retry nodes' })).not.toBeInTheDocument()
  })
})

function makeSource(): ProxySource {
  return {
    id: 'source-1',
    name: 'Airport',
    type: 'url',
    url: 'https://example.com/sub',
    format: 'auto',
    enabled: true,
    nodeCount: 2,
    updateInterval: 0,
    tags: [],
    groups: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
