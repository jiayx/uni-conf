import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { RemoteRuleSets } from './RemoteRuleSets'
import { api, ApiError } from '@/lib/api'
import i18n from '@/i18n'
import { useSettingsStore } from '@/store/settings.store'

const groupStore = vi.hoisted(() => ({
  fetchGroups: vi.fn(async () => undefined),
  groups: [{
    id: 'builtin-proxy', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: [],
    enabled: true, order: 0, isBuiltin: true,
  }],
}))

vi.mock('@/store/groups.store', () => ({
  useGroupsStore: () => groupStore,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        ...actual.api.settings,
        get: vi.fn(),
      },
      sources: {
        ...actual.api.sources,
        list: vi.fn(),
        listRuleSets: vi.fn(),
      },
      remoteRuleSets: {
        ...actual.api.remoteRuleSets,
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      ruleSetCatalogs: {
        ...actual.api.ruleSetCatalogs,
        getQuixotic: vi.fn(),
      },
    },
  }
})

describe('RemoteRuleSets content validation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      unmatchedTrafficPolicy: 'proxy',
      ruleSetConversionPolicy: 'compatible',
    })
    vi.mocked(api.settings.get).mockResolvedValue(useSettingsStore.getState())
    await i18n.changeLanguage('en')
    groupStore.groups.splice(0, groupStore.groups.length, {
      id: 'builtin-proxy', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: [],
      enabled: true, order: 0, isBuiltin: true,
    })
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([{
      id: 'custom-domains',
      name: 'Custom Domains',
      url: 'https://example.com/domains.list',
      format: 'text',
      behavior: 'domain',
      sourceOverrides: {},
      targetGroupId: 'builtin-proxy',
      updateInterval: 24,
      enabled: true,
      sortOrder: 500,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }])
    vi.mocked(api.sources.list).mockResolvedValue([])
    vi.mocked(api.sources.listRuleSets).mockResolvedValue([])
    vi.mocked(api.ruleSetCatalogs.getQuixotic).mockResolvedValue({
      id: 'quixotic',
      name: 'Quixotic',
      repositoryUrl: 'https://github.com/QuixoticHeart/rule-set',
      branch: 'ruleset',
      syncedAt: '2026-07-28T00:00:00.000Z',
      items: [],
    })
  })

  it('opens and focuses the requested target-native source from a conversion remediation link', async () => {
    render(
      <MemoryRouter initialEntries={['/remote-rule-sets?edit=custom-domains&nativeSource=singbox']}>
        <RemoteRuleSets />
      </MemoryRouter>,
    )

    const nativeSourceInput = await screen.findByRole('textbox', {
      name: 'sing-box native rule-set URL',
    })
    expect(nativeSourceInput).toBeVisible()
    await waitFor(() => expect(nativeSourceInput).toHaveFocus())
  })

  it('preserves a changed supplemental rule set when discard is cancelled', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Draft Domains')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    const editor = screen.getByRole('dialog', { name: 'Edit Supplemental Rule Set' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(editor).getByRole('alert')).toHaveTextContent('Unsaved changes')
    expect(name).toHaveValue('Draft Domains')
    await user.click(within(editor).getByRole('button', { name: 'Continue editing' }))
  })

  it('stores a target-native source override for an incompatible client', async () => {
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (id, patch) => ({
      ...(await api.remoteRuleSets.list())[0]!,
      ...patch,
      id,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(
      screen.getByRole('textbox', { name: 'Egern native rule-set URL' }),
      'https://rules.example.com/native-egern.yaml'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.remoteRuleSets.update).toHaveBeenCalledWith('custom-domains', expect.objectContaining({
      sourceOverrides: { egern: 'https://rules.example.com/native-egern.yaml' },
    }))
    expect(await screen.findByText('1 native sources')).toBeInTheDocument()
  })

  it('sends an explicit empty value when clearing existing notes', async () => {
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([{
      ...(await api.remoteRuleSets.list())[0]!,
      notes: 'Remove this note',
    }])
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (id, patch) => ({
      ...(await api.remoteRuleSets.list())[0]!,
      ...patch,
      id,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByRole('textbox', { name: 'Notes' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.remoteRuleSets.update).toHaveBeenCalledWith('custom-domains', expect.objectContaining({ notes: '' }))
  })

  it('only edits target-native sources on a system-managed rule set', async () => {
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([{
      ...makeRuleSet('managed-ai', 'Managed AI', 'builtin-proxy', 'mihomo'),
      behavior: 'classical',
      presetSource: 'quixotic',
      presetId: 'ai',
    }])
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (id, patch) => ({
      ...(await api.remoteRuleSets.list())[0]!,
      ...patch,
      id,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Configure sources' }))
    const dialog = screen.getByRole('dialog', { name: 'Configure Native Sources · Managed AI' })
    expect(dialog).toHaveTextContent('The system keeps the default source and routing metadata up to date.')
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Traffic destination' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discover native sources (7)' })).toBeInTheDocument()

    await user.type(
      screen.getByRole('textbox', { name: 'sing-box native rule-set URL' }),
      'https://rules.example.com/managed-ai.srs',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.remoteRuleSets.update).toHaveBeenCalledWith('managed-ai', {
      sourceOverrides: { singbox: 'https://rules.example.com/managed-ai.srs' },
    })
  })

  it('overrides and restores the target of a system-managed rule set', async () => {
    const managed = {
      ...makeRuleSet('managed-streaming', 'Managed Streaming', 'builtin-streaming', 'mihomo'),
      presetSource: 'quixotic' as const,
      presetId: 'netflix',
      defaultTargetGroupId: 'builtin-streaming',
    }
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([managed])
    groupStore.groups.splice(
      0,
      groupStore.groups.length,
      {
        id: 'builtin-proxy', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: [],
        enabled: true, order: 0, isBuiltin: true,
      },
      {
        id: 'builtin-streaming', name: 'Streaming', type: 'select', collectionIds: [], groupIds: [], builtins: [],
        enabled: true, order: 1, isBuiltin: true,
      },
    )
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (_id, patch) => ({
      ...managed,
      targetOverrideGroupId: patch.targetOverrideGroupId,
      targetGroupId: patch.targetOverrideGroupId || managed.targetGroupId,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Change target' }))
    const target = screen.getByRole('combobox', { name: 'New destination' })
    expect(within(target).getByRole('option', { name: 'Follow system: Streaming' })).toHaveValue('')
    await user.selectOptions(target, 'builtin-proxy')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.remoteRuleSets.update).toHaveBeenCalledWith('managed-streaming', {
      targetOverrideGroupId: 'builtin-proxy',
    })
    expect(await screen.findByText('System default Streaming · Current PROXY')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change target' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'New destination' }), '')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.remoteRuleSets.update).toHaveBeenLastCalledWith('managed-streaming', {
      targetOverrideGroupId: null,
    })
    await waitFor(() => {
      expect(screen.queryByText('System default Streaming · Current PROXY')).not.toBeInTheDocument()
    })
  })

  it('associates every primary rule-set form select with its visible label', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Supplemental Rule Set' }))

    expect(screen.getByRole('combobox', { name: 'Rule set source' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rule Set Format' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Match Content' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Traffic destination' })).toBeInTheDocument()
  })

  it('offers non-default Quixotic rules without assuming an outlet', async () => {
    vi.mocked(api.ruleSetCatalogs.getQuixotic).mockResolvedValue({
      id: 'quixotic',
      name: 'Quixotic',
      repositoryUrl: 'https://github.com/QuixoticHeart/rule-set',
      branch: 'ruleset',
      syncedAt: '2026-07-28T00:00:00.000Z',
      items: [{
        id: 'iplocation-proxy',
        name: 'IP Location Proxy',
        provisioning: 'optional',
        sortOrder: 900,
        sources: [{
          sourceId: 'mihomo',
          url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/meta/iplocation-proxy.list',
          format: 'mihomo',
          behavior: 'classical',
          default: true,
          nativeFor: ['mihomo'],
        }],
      }],
    })
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Supplemental Rule Set' }))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Rule set source' }),
      'catalog:iplocation-proxy',
    )

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('IP Location Proxy')
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue(
      'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/meta/iplocation-proxy.list',
    )
    expect(screen.getByRole('combobox', { name: 'Traffic destination' })).toHaveValue('')
  })

  it('creates a supplemental rule set linked to a subscription provider', async () => {
    vi.mocked(api.sources.list).mockResolvedValue([{
      id: 'source-1',
      name: 'Full Config',
      type: 'url',
      url: 'https://subscription.example.com/config.yaml',
      format: 'mihomo',
      enabled: true,
      nodeCount: 3,
      tags: [],
      groups: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }])
    vi.mocked(api.sources.listRuleSets).mockResolvedValue([{
      key: 'streaming',
      name: 'streaming',
      url: 'https://rules.example.com/streaming.yaml',
      format: 'mihomo',
      behavior: 'classical',
      updateInterval: 2,
      upstreamTarget: 'PROXY',
      referenced: true,
    }])
    vi.mocked(api.remoteRuleSets.create).mockImplementation(async payload => ({
      id: 'source-streaming',
      ...payload,
      sourceMissing: false,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Supplemental Rule Set' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rule set source' }), 'source:source-1')
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Subscription rule set' }),
      'streaming',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.remoteRuleSets.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'streaming',
      url: 'https://rules.example.com/streaming.yaml',
      format: 'mihomo',
      behavior: 'classical',
      sourceId: 'source-1',
      sourceRuleSetKey: 'streaming',
      targetGroupId: 'builtin-proxy',
      updateInterval: 2,
    })))
  })

  it('discovers known repository sources without overwriting manual values', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const defaultUrl = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list')
    await user.click(screen.getByText('Target-native sources (optional)'))
    const egernUrl = screen.getByRole('textbox', { name: 'Egern native rule-set URL' })
    const singboxUrl = screen.getByRole('textbox', { name: 'sing-box native rule-set URL' })
    await user.type(egernUrl, 'https://manual.example.com/games.yaml')

    await user.click(screen.getByRole('button', { name: 'Discover native sources (6)' }))

    expect(egernUrl).toHaveValue('https://manual.example.com/games.yaml')
    expect(singboxUrl).toHaveValue(
      'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/singbox/version5/games.srs'
    )
    expect(screen.getByText('Filled 6 known repository sources. Review them before saving.')).toBeInTheDocument()

    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/ai.list')
    expect(egernUrl).toHaveValue('https://manual.example.com/games.yaml')
    expect(singboxUrl).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Discover native sources (6)' })).toBeInTheDocument()
  })

  it('keeps the editor open and explains a save failure', async () => {
    vi.mocked(api.remoteRuleSets.update).mockRejectedValue(
      new ApiError('Native source URL is not publicly reachable', 400, 'invalid_source_override')
    )
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Native source URL is not publicly reachable')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('collapses a large policy library and searches across hidden sections', async () => {
    groupStore.groups.splice(0, groupStore.groups.length,
      { id: 'builtin-proxy', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 0, isBuiltin: true },
      { id: 'builtin-ai', name: 'AI', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 1, isBuiltin: true },
      { id: 'builtin-streaming', name: 'Streaming', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 2, isBuiltin: true },
      { id: 'builtin-social', name: 'Social', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 3, isBuiltin: true },
    )
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([
      makeRuleSet('proxy-domains', 'Proxy Domains', 'builtin-proxy'),
      makeRuleSet('ai-services', 'AI Services', 'builtin-ai'),
      makeRuleSet('netflix', 'Netflix', 'builtin-streaming'),
      makeRuleSet('social-media', 'Social Media', 'builtin-social'),
    ])
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: 'Toggle rule sets for PROXY' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Toggle rule sets for / })
      .every(button => button.getAttribute('aria-expanded') === 'true')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle rule sets for PROXY' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('Proxy Domains')).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Find rule sets' }))
    await user.type(screen.getByRole('textbox', { name: 'Find rule sets' }), 'Netflix')
    expect(screen.getByText('Netflix')).toBeInTheDocument()
    expect(screen.queryByText('Proxy Domains')).not.toBeInTheDocument()
    expect(screen.getByText('1 matching rule sets across 1 policies')).toBeInTheDocument()
  })

  it('keeps the full policy header row inside the expand button', async () => {
    groupStore.groups.splice(0, groupStore.groups.length, {
      id: 'builtin-gaming', name: 'Gaming', type: 'select', collectionIds: [], groupIds: [], builtins: [],
      enabled: false, order: 0, isBuiltin: true,
    })
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([
      makeRuleSet('games', 'Games', 'builtin-gaming'),
    ])
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    const toggle = await screen.findByRole('button', { name: 'Toggle rule sets for Gaming' })
    expect(screen.getByText('Disabled by current scenarios').closest('button')).toBe(toggle)
  })

  it('places active rule sets before inactive rule sets within a target', async () => {
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([
      { ...makeRuleSet('inactive-first', 'Inactive First', 'builtin-proxy'), enabled: false, sortOrder: 0 },
      { ...makeRuleSet('active-second', 'Active Second', 'builtin-proxy'), sortOrder: 999 },
    ])
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    const active = await screen.findByText('Active Second')
    const inactive = screen.getByText('Inactive First')
    expect(active.compareDocumentPosition(inactive) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('summarizes and filters rule sets by target-client compatibility', async () => {
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([
      makeRuleSet('native-mihomo', 'Native Mihomo', 'builtin-proxy', 'mihomo'),
      makeRuleSet('convert-singbox', 'Convert sing-box', 'builtin-proxy', 'singbox'),
      makeRuleSet('unsupported-surge', 'Unsupported Surge', 'builtin-proxy', 'surge'),
    ])
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Check target client' }), 'mihomo')

    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Native 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Safe conversion 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unsupported 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unsupported 1' }))

    expect(screen.getByText('Unsupported Surge')).toBeInTheDocument()
    expect(screen.queryByText('Native Mihomo')).not.toBeInTheDocument()
    expect(screen.queryByText('Convert sing-box')).not.toBeInTheDocument()
    expect(screen.getByText('1 matching rule sets across 1 policies')).toBeInTheDocument()
  })

})

function makeRuleSet(
  id: string,
  name: string,
  targetGroupId: string,
  format: 'text' | 'mihomo' | 'singbox' | 'surge' = 'text',
) {
  return {
    id,
    name,
    url: `https://example.com/${id}.list`,
    format,
    behavior: 'domain' as const,
    sourceOverrides: {},
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  }
}
