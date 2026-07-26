import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
        validate: vi.fn(),
        validateAllSources: vi.fn(),
        validateSource: vi.fn(),
        validateSources: vi.fn(),
        previewConversion: vi.fn(),
      },
    },
  }
})

describe('RemoteRuleSets content validation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    useSettingsStore.setState({ ruleSetConversionPolicy: 'compatible' })
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
    vi.mocked(api.remoteRuleSets.validate).mockResolvedValue({
      status: 'warning',
      checkedAt: '2026-07-14T00:00:00.000Z',
      url: 'https://example.com/domains.list',
      format: 'text',
      behavior: 'domain',
      inspectionMode: 'text',
      httpStatus: 200,
      contentType: 'text/plain',
      byteLength: 1536,
      ruleCount: 12,
      invalidRuleCount: 1,
      issues: [{
        code: 'invalid_rule',
        severity: 'warning',
        message: '第 12 条规则与 domain 内容类型不匹配',
        messageEn: 'Rule 12 does not match the domain behavior.',
        line: 12,
      }],
    })
    vi.mocked(api.remoteRuleSets.validateSource).mockResolvedValue({
      status: 'valid',
      checkedAt: '2026-07-18T00:00:00.000Z',
      url: 'https://rules.example.com/native-egern.yaml',
      format: 'egern',
      behavior: 'domain',
      inspectionMode: 'structured',
      httpStatus: 200,
      contentType: 'text/yaml',
      byteLength: 512,
      ruleCount: 7,
      invalidRuleCount: 0,
      issues: [],
    })
    vi.mocked(api.remoteRuleSets.previewConversion).mockResolvedValue({
      targetFormat: 'singbox',
      sourceFormat: 'text',
      outputFormat: 'singbox',
      mode: 'converted',
      convertedRuleCount: 11,
      skippedRuleCount: 1,
      skippedRuleTypes: { SCRIPT: 1 },
      convertedExamples: [
        { source: 'DOMAIN-SUFFIX,example.com', target: '{"domain_suffix":["example.com"]}' },
      ],
      convertedExamplesTruncated: true,
      issues: [{
        type: 'SCRIPT', count: 1, reason: 'unsupported-directive', resolution: 'use-native-source', examples: ['SCRIPT,legacy-script'],
      }],
      contentType: 'application/json; charset=utf-8',
      preview: '{\n  "version": 3\n}',
      truncated: true,
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

  it('validates a rule set and displays its content summary and issues', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Validate Content' }))

    expect(api.remoteRuleSets.validate).toHaveBeenCalledWith('custom-domains')
    expect(await screen.findByRole('status')).toHaveTextContent('Needs review')
    expect(screen.getByRole('status')).toHaveTextContent('1.5 KiB downloaded')
    expect(screen.getByRole('status')).toHaveTextContent('12 rules')
    expect(screen.getByRole('status')).toHaveTextContent('1 invalid')
    expect(screen.getByRole('status')).toHaveTextContent('Rule 12 does not match the domain behavior.')
  })

  it('checks every stored source and shows card-level health details', async () => {
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([{
      ...makeRuleSet('multi-source', 'Multi-source Rules', 'builtin-proxy'),
      format: 'mihomo',
      sourceOverrides: {
        egern: 'https://example.com/egern.yaml',
        singbox: 'https://example.com/singbox.json',
      },
    }])
    const validResult = {
      status: 'valid' as const,
      checkedAt: '2026-07-18T01:00:00.000Z',
      url: 'https://example.com/default.yaml',
      format: 'mihomo' as const,
      behavior: 'domain' as const,
      inspectionMode: 'structured' as const,
      httpStatus: 200,
      contentType: 'text/yaml',
      byteLength: 512,
      ruleCount: 10,
      invalidRuleCount: 0,
      issues: [],
    }
    vi.mocked(api.remoteRuleSets.validateAllSources).mockResolvedValue({
      status: 'invalid',
      checkedAt: '2026-07-18T01:00:00.000Z',
      defaultSource: validResult,
      sourceOverrides: [{
        targetFormat: 'egern',
        result: {
          ...validResult,
          status: 'invalid',
          url: 'https://example.com/egern.yaml',
          format: 'egern',
          ruleCount: 0,
          invalidRuleCount: 1,
          issues: [{
            code: 'invalid_content', severity: 'error',
            message: 'Egern 来源内容无效', messageEn: 'The Egern source content is invalid.',
          }],
        },
      }, {
        targetFormat: 'singbox',
        result: {
          ...validResult,
          status: 'warning',
          url: 'https://example.com/singbox.json',
          format: 'singbox',
          ruleCount: 8,
          invalidRuleCount: 1,
          issues: [{
            code: 'invalid_rule', severity: 'warning',
            message: '有一条规则需要检查', messageEn: 'One rule needs review.',
          }],
        },
      }],
      summary: { total: 3, valid: 1, warning: 1, invalid: 1 },
    })

    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    expect(await screen.findByText('Sources need checking')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check all sources' }))

    expect(api.remoteRuleSets.validateAllSources).toHaveBeenCalledWith('multi-source')
    const health = await screen.findByRole('status')
    expect(health).toHaveTextContent('1 valid · 1 review · 1 invalid')
    expect(health).toHaveTextContent('Default source')
    expect(health).toHaveTextContent('Egern')
    expect(health).toHaveTextContent('sing-box')
    expect(health).toHaveTextContent('The Egern source content is invalid.')
    expect(health).toHaveTextContent('One rule needs review.')
    expect(screen.queryByText('Sources need checking')).not.toBeInTheDocument()
    expect(api.remoteRuleSets.validate).not.toHaveBeenCalled()
  })

  it('restores an expired source-health snapshot without presenting it as current', async () => {
    const defaultSource = {
      status: 'valid' as const,
      checkedAt: '2026-07-16T00:00:00.000Z',
      url: 'https://example.com/default.yaml',
      format: 'mihomo' as const,
      behavior: 'domain' as const,
      inspectionMode: 'structured' as const,
      httpStatus: 200,
      byteLength: 512,
      ruleCount: 10,
      invalidRuleCount: 0,
      issues: [],
    }
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([{
      ...makeRuleSet('stale-source', 'Stale Source Health', 'builtin-proxy'),
      sourceOverrides: { egern: 'https://example.com/egern.yaml' },
      sourceHealth: {
        status: 'valid',
        checkedAt: '2026-07-16T00:00:00.000Z',
        expiresAt: '2026-07-17T00:00:00.000Z',
        stale: true,
        defaultSource,
        sourceOverrides: [],
        summary: { total: 1, valid: 1, warning: 0, invalid: 0 },
      },
    }])

    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    expect(await screen.findByText('Source check expired')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('This check result has expired')
    expect(screen.getByRole('button', { name: 'Check all sources again' })).toBeInTheDocument()
    expect(screen.queryByText('Sources need checking')).not.toBeInTheDocument()
  })

  it('previews a safe cross-client conversion with preserved and skipped counts', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Compatibility Preview' }))

    expect(api.remoteRuleSets.previewConversion).toHaveBeenCalledWith('custom-domains', 'singbox')
    expect(await screen.findByRole('dialog')).toHaveTextContent('Compatibility Preview · Custom Domains')
    expect(screen.getByRole('combobox', { name: 'Target Client' })).toBeInTheDocument()
    const result = await screen.findByRole('status')
    expect(result).toHaveTextContent('Safe conversion')
    expect(result).toHaveTextContent('text → singbox')
    expect(result).toHaveTextContent('Preserved rules: 11')
    expect(result).toHaveTextContent('Skipped rules: 1')
    expect(result).toHaveTextContent('SCRIPT × 1')
    expect(result).toHaveTextContent('Safe rule mappings')
    expect(result).toHaveTextContent('Source rule')
    expect(result).toHaveTextContent('Target rule')
    expect(result).toHaveTextContent('DOMAIN-SUFFIX,example.com')
    expect(result).toHaveTextContent('{"domain_suffix":["example.com"]}')
    expect(result).toHaveTextContent('Showing the first 20 distinct mappings')
    expect(result).toHaveTextContent('Unconverted rule details')
    expect(result).toHaveTextContent('The target client has no equivalent directive')
    expect(result).toHaveTextContent('Recommended action:')
    expect(result).toHaveTextContent('Provide a native rule-set source for this target client')
    expect(result).toHaveTextContent('SCRIPT,legacy-script')
    expect(result).toHaveTextContent('Only the first part is shown')
    expect(result).toHaveTextContent('"version": 3')

    await user.click(screen.getByRole('button', { name: 'Configure sing-box native source' }))
    expect(await screen.findByRole('dialog', { name: 'Edit Supplemental Rule Set' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'sing-box native rule-set URL' })).toHaveFocus()
  })

  it('keeps the last successful conversion visible but marks it stale after a refresh failure', async () => {
    vi.mocked(api.remoteRuleSets.previewConversion)
      .mockResolvedValueOnce({
        checkedAt: '2026-07-24T08:30:00.000Z',
        targetFormat: 'singbox',
        sourceFormat: 'text',
        outputFormat: 'singbox',
        mode: 'converted',
        convertedRuleCount: 11,
        skippedRuleCount: 0,
        skippedRuleTypes: {},
        issues: [],
        convertedExamples: [],
        convertedExamplesTruncated: false,
        preview: '{"version":3}',
        truncated: false,
      })
      .mockRejectedValueOnce(new ApiError('Upstream unavailable', 502, 'download_failed'))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Compatibility Preview' }))
    expect(await screen.findByText('Preserved rules: 11')).toBeInTheDocument()
    expect(screen.getByText(/Preview generated/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh Preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be downloaded')
    expect(screen.getByText('This is the last successful result. The refresh failed, so it may not match the current source.')).toBeInTheDocument()
    expect(screen.getByText('Preserved rules: 11')).toBeInTheDocument()
    expect(screen.getByText(/Preview generated/)).toBeInTheDocument()
  })

  it('does not recommend a native source when safe conversion is complete', async () => {
    vi.mocked(api.remoteRuleSets.previewConversion).mockResolvedValue({
      targetFormat: 'singbox', sourceFormat: 'text', outputFormat: 'singbox', mode: 'converted',
      convertedRuleCount: 12, skippedRuleCount: 0, skippedRuleTypes: {}, issues: [],
      convertedExamples: [], convertedExamplesTruncated: true,
      contentType: 'application/json; charset=utf-8', preview: '{"version":3}', truncated: false,
    })
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Compatibility Preview' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Preserved rules: 12')
    expect(screen.queryByRole('button', { name: 'Configure sing-box native source' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('combobox', { name: 'Use After Match' })).not.toBeInTheDocument()
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

  it('keeps target-native sources available after selecting a library preset', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Supplemental Rule Set' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rule set source' }), 'ai')
    await user.click(screen.getByText('Target-native sources (optional)'))

    expect(screen.getByRole('textbox', { name: 'sing-box native rule-set URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discover native sources (9)' })).toBeInTheDocument()
  })

  it('associates every primary rule-set form select with its visible label', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Supplemental Rule Set' }))

    expect(screen.getByRole('combobox', { name: 'Rule set source' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rule Set Format' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Match Content' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Use After Match' })).toBeInTheDocument()
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

  it('validates a target-native source before saving it', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(
      screen.getByRole('textbox', { name: 'Egern native rule-set URL' }),
      'https://rules.example.com/native-egern.yaml'
    )
    await user.click(screen.getByRole('button', { name: 'Validate Egern native rule-set source' }))

    expect(api.remoteRuleSets.validateSource).toHaveBeenCalledWith({
      url: 'https://rules.example.com/native-egern.yaml', targetFormat: 'egern', behavior: 'domain',
    })
    expect(await screen.findByText('Content valid')).toBeInTheDocument()
    expect(screen.getByText('7 rules')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Egern native rule-set URL' }), '?v=2')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('localizes unsafe target-native source errors', async () => {
    vi.mocked(api.remoteRuleSets.validateSource).mockRejectedValue(
      new ApiError('url must be a public http(s) URL', 400, 'unsafe_url')
    )
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(screen.getByRole('textbox', { name: 'Egern native rule-set URL' }), 'http://127.0.0.1/rules')
    await user.click(screen.getByRole('button', { name: 'Validate Egern native rule-set source' }))

    expect(await screen.findByText(/publicly reachable HTTP\(S\) URL/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/Fix or remove 1 native sources/)).toBeInTheDocument()
    expect(api.remoteRuleSets.update).not.toHaveBeenCalled()
  })

  it('keeps failed native-source validation advisory while allowing save', async () => {
    vi.mocked(api.remoteRuleSets.validateSource).mockResolvedValue({
      status: 'invalid', checkedAt: '2026-07-18T00:00:00.000Z',
      url: 'https://rules.example.com/broken.yaml', format: 'egern', behavior: 'domain',
      inspectionMode: 'structured', httpStatus: 200, byteLength: 64,
      invalidRuleCount: 0,
      issues: [{
        code: 'invalid_structure', severity: 'error',
        message: '结构无效', messageEn: 'The source structure is invalid.',
      }],
    })
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (id, patch) => ({
      ...(await api.remoteRuleSets.list())[0]!, ...patch, id,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(screen.getByRole('textbox', { name: 'Egern native rule-set URL' }), 'https://rules.example.com/broken.yaml')
    await user.click(screen.getByRole('button', { name: 'Validate Egern native rule-set source' }))
    expect(await screen.findByText(/1 native sources failed content or availability checks/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.remoteRuleSets.update).toHaveBeenCalledTimes(1)
  })

  it('allows warning-only native sources without a failure acknowledgement', async () => {
    vi.mocked(api.remoteRuleSets.validateSource).mockResolvedValue({
      status: 'warning', checkedAt: '2026-07-18T00:00:00.000Z',
      url: 'https://rules.example.com/native.srs', format: 'singbox', behavior: 'domain',
      inspectionMode: 'binary-header', httpStatus: 200, byteLength: 64,
      invalidRuleCount: 0,
      issues: [{ code: 'binary_header_only', severity: 'warning', message: '仅校验容器头', messageEn: 'Header only.' }],
    })
    vi.mocked(api.remoteRuleSets.update).mockImplementation(async (id, patch) => ({
      ...(await api.remoteRuleSets.list())[0]!, ...patch, id,
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(screen.getByRole('textbox', { name: 'sing-box native rule-set URL' }), 'https://rules.example.com/native.srs')
    await user.click(screen.getByRole('button', { name: 'Validate sing-box native rule-set source' }))
    expect(await screen.findByText('Needs review')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /understand the risk/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.remoteRuleSets.update).toHaveBeenCalledTimes(1)
  })

  it('validates every configured native source and summarizes overall health', async () => {
    vi.mocked(api.remoteRuleSets.validateSources).mockResolvedValue({ results: [
      {
        targetFormat: 'egern',
        result: {
          status: 'valid', checkedAt: '2026-07-18T00:00:00.000Z',
          url: 'https://rules.example.com/native-egern.yaml', format: 'egern', behavior: 'domain',
          inspectionMode: 'structured', httpStatus: 200, byteLength: 512,
          ruleCount: 7, invalidRuleCount: 0, issues: [],
        },
      },
      {
        targetFormat: 'singbox',
        result: {
          status: 'warning', checkedAt: '2026-07-18T00:00:00.000Z',
          url: 'https://rules.example.com/native-singbox.srs', format: 'singbox', behavior: 'domain',
          inspectionMode: 'binary-header', httpStatus: 200, byteLength: 256,
          invalidRuleCount: 0,
          issues: [{
            code: 'binary_header_only', severity: 'warning',
            message: '仅校验容器头', messageEn: 'Only the binary header was inspected.',
          }],
        },
      },
    ] })
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.type(screen.getByRole('textbox', { name: 'Egern native rule-set URL' }), 'https://rules.example.com/native-egern.yaml')
    await user.type(screen.getByRole('textbox', { name: 'sing-box native rule-set URL' }), 'https://rules.example.com/native-singbox.srs')
    await user.click(screen.getByRole('button', { name: 'Validate configured sources (2)' }))

    expect(api.remoteRuleSets.validateSources).toHaveBeenCalledWith([
      { url: 'https://rules.example.com/native-singbox.srs', targetFormat: 'singbox', behavior: 'domain' },
      { url: 'https://rules.example.com/native-egern.yaml', targetFormat: 'egern', behavior: 'domain' },
    ])
    expect(await screen.findByText('Checked 2/2 · 1 valid · 1 review · 0 invalid · 0 failed')).toBeInTheDocument()
    expect(screen.getByText('Only the binary header was inspected.')).toBeInTheDocument()
  })

  it('discovers known repository sources without overwriting manual values', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const defaultUrl = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list')
    await user.click(screen.getByText('Target-native sources (optional)'))
    const validateAfterDiscovery = screen.getByRole('checkbox', { name: 'Validate immediately after discovery' })
    expect(validateAfterDiscovery).not.toBeChecked()
    const egernUrl = screen.getByRole('textbox', { name: 'Egern native rule-set URL' })
    const singboxUrl = screen.getByRole('textbox', { name: 'sing-box native rule-set URL' })
    await user.type(egernUrl, 'https://manual.example.com/games.yaml')

    await user.click(screen.getByRole('button', { name: 'Discover native sources (6)' }))

    expect(egernUrl).toHaveValue('https://manual.example.com/games.yaml')
    expect(singboxUrl).toHaveValue(
      'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/singbox/version5/games.srs'
    )
    expect(screen.getByText('Filled 6 known repository sources. Review and validate them before saving.')).toBeInTheDocument()

    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/ai.list')
    expect(egernUrl).toHaveValue('https://manual.example.com/games.yaml')
    expect(singboxUrl).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Discover native sources (6)' })).toBeInTheDocument()
    expect(api.remoteRuleSets.validateSources).not.toHaveBeenCalled()
  })

  it('does not validate discovered sources unless explicitly requested', async () => {
    vi.mocked(api.remoteRuleSets.validateSources).mockImplementation(async sources => ({
      results: sources.map(source => ({
        targetFormat: source.targetFormat,
        result: {
          status: 'valid' as const,
          checkedAt: '2026-07-18T00:00:00.000Z',
          url: source.url,
          format: source.targetFormat,
          behavior: source.behavior,
          inspectionMode: 'text' as const,
          httpStatus: 200,
          byteLength: 128,
          ruleCount: 4,
          invalidRuleCount: 0,
          issues: [],
        },
      })),
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const defaultUrl = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list')
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.click(screen.getByRole('button', { name: 'Discover native sources (7)' }))

    expect(api.remoteRuleSets.validateSources).not.toHaveBeenCalled()
  })

  it('ignores discovery validation results after the default source changes', async () => {
    let capturedSources: Parameters<typeof api.remoteRuleSets.validateSources>[0] = []
    let resolveValidation!: (value: Awaited<ReturnType<typeof api.remoteRuleSets.validateSources>>) => void
    vi.mocked(api.remoteRuleSets.validateSources).mockImplementation(sources => {
      capturedSources = sources
      return new Promise(resolve => { resolveValidation = resolve })
    })
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const defaultUrl = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/games.list')
    await user.click(screen.getByText('Target-native sources (optional)'))
    await user.click(screen.getByRole('checkbox', { name: 'Validate immediately after discovery' }))
    await user.click(screen.getByRole('button', { name: 'Discover native sources (7)' }))

    expect(capturedSources).toHaveLength(7)
    await user.clear(defaultUrl)
    await user.type(defaultUrl, 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/ai.list')
    await act(async () => resolveValidation({
      results: capturedSources.map(source => ({
        targetFormat: source.targetFormat,
        result: {
          status: 'valid', checkedAt: '2026-07-18T00:00:00.000Z',
          url: source.url, format: source.targetFormat, behavior: source.behavior,
          inspectionMode: 'text', httpStatus: 200, byteLength: 128,
          ruleCount: 4, invalidRuleCount: 0, issues: [],
        },
      })),
    }))

    expect(screen.getByRole('textbox', { name: 'sing-box native rule-set URL' })).toHaveValue('')
    expect(screen.queryByText(/Checked \d+\/\d+/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discover native sources (7)' })).toBeInTheDocument()
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

  it('does not reopen a preview modal when a closed request finishes later', async () => {
    let resolvePreview!: (value: Awaited<ReturnType<typeof api.remoteRuleSets.previewConversion>>) => void
    vi.mocked(api.remoteRuleSets.previewConversion).mockReturnValue(new Promise(resolve => { resolvePreview = resolve }))
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Compatibility Preview' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    resolvePreview({
      targetFormat: 'singbox', sourceFormat: 'text', outputFormat: 'singbox', mode: 'converted',
      convertedRuleCount: 1, skippedRuleCount: 0, truncated: false,
      skippedRuleTypes: {},
      issues: [],
      convertedExamples: [],
      convertedExamplesTruncated: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('turns typed conversion failures into actionable localized guidance', async () => {
    vi.mocked(api.remoteRuleSets.previewConversion).mockRejectedValue(
      new ApiError('Rule set is too large to convert', 413, 'too_large')
    )
    const user = userEvent.setup()
    render(<MemoryRouter><RemoteRuleSets /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Compatibility Preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('exceeds the 4 MiB safe conversion limit')
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
    expect(screen.queryByRole('button', { name: 'Compatibility Preview' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle rule sets for PROXY' }))
    expect(screen.getByRole('button', { name: 'Compatibility Preview' })).toBeInTheDocument()
    expect(screen.getByText('Proxy Domains')).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Find rule sets' }))
    await user.type(screen.getByRole('textbox', { name: 'Find rule sets' }), 'Netflix')
    expect(screen.getByText('Netflix')).toBeInTheDocument()
    expect(screen.queryByText('Proxy Domains')).not.toBeInTheDocument()
    expect(screen.getByText('1 matching rule sets across 1 policies')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Needs attention 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unsupported 1' }))

    expect(screen.getByText('Unsupported Surge')).toBeInTheDocument()
    expect(screen.queryByText('Native Mihomo')).not.toBeInTheDocument()
    expect(screen.queryByText('Convert sing-box')).not.toBeInTheDocument()
    expect(screen.getByText('1 matching rule sets across 1 policies')).toBeInTheDocument()
  })

  it('filters the library to enabled rule sets whose source health needs attention', async () => {
    const checkedAt = '2026-07-18T00:00:00.000Z'
    const validSource = {
      status: 'valid' as const,
      checkedAt,
      url: 'https://example.com/default.list',
      format: 'text' as const,
      behavior: 'domain' as const,
      inspectionMode: 'text' as const,
      httpStatus: 200,
      byteLength: 128,
      ruleCount: 4,
      invalidRuleCount: 0,
      issues: [],
    }
    vi.mocked(api.remoteRuleSets.list).mockResolvedValue([
      {
        ...makeRuleSet('healthy-native', 'Healthy Native Sources', 'builtin-proxy'),
        sourceOverrides: { egern: 'https://example.com/healthy.yaml' },
        sourceHealth: {
          status: 'valid',
          checkedAt,
          expiresAt: '2026-07-19T00:00:00.000Z',
          stale: false,
          defaultSource: validSource,
          sourceOverrides: [],
          summary: { total: 1, valid: 1, warning: 0, invalid: 0 },
        },
      },
      {
        ...makeRuleSet('pending-native', 'Pending Native Sources', 'builtin-proxy'),
        sourceOverrides: { egern: 'https://example.com/pending.yaml' },
      },
      makeRuleSet('ordinary', 'Ordinary Rule Set', 'builtin-proxy'),
    ])
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/remote-rule-sets?attention=1']}>
        <RemoteRuleSets />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Needs attention 1' })).toHaveAttribute('aria-pressed', 'true')

    expect(screen.getByText('Pending Native Sources')).toBeInTheDocument()
    expect(screen.queryByText('Healthy Native Sources')).not.toBeInTheDocument()
    expect(screen.queryByText('Ordinary Rule Set')).not.toBeInTheDocument()
    expect(screen.getByText('1 matching rule sets across 1 policies')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All states 3' }))
    expect(screen.getByText('Healthy Native Sources')).toBeInTheDocument()
    expect(screen.getByText('Ordinary Rule Set')).toBeInTheDocument()
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
