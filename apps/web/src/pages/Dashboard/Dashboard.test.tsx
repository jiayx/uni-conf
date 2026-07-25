import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Dashboard } from './Dashboard'
import { api } from '@/lib/api'
import i18n from '@/i18n'
import type { AppSettings, DashboardStats } from '@uni-conf/types'

const applySettings = vi.hoisted(() => vi.fn())

vi.mock('@/store/settings.store', () => ({
  useSettingsStore: (selector: (state: { applySettings: typeof applySettings }) => unknown) => selector({ applySettings }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboard: { stats: vi.fn() },
      settings: { ...actual.api.settings, get: vi.fn(), update: vi.fn() },
      export: { ...actual.api.export, readinessFormat: vi.fn(), downloadFormat: vi.fn() },
    },
  }
})

const settings: AppSettings = {
  language: 'en', theme: 'system', routingPolicyTemplate: 'common', dnsMode: 'smart',
  exportNodeNamingMode: 'smart', showCompatibilityWarnings: true, enableAutoRefresh: true,
  ruleSetConversionPolicy: 'compatible',
  autoRefreshInterval: 1440, autoNodeGroupsEnabled: true, autoNodeGroupTypes: ['url-test'],
  autoNodeGroupIncludeFlag: true,
}

const stats: DashboardStats = {
  sourceCount: 1, nodeCount: 1, enabledNodeCount: 1, collectionCount: 1,
  groupCount: 1, ruleCount: 1, exportConfigCount: 1,
  defaultExportToken: 'token-1', defaultExportFormat: 'mihomo', defaultExportEnabled: false,
}

describe('Dashboard public export state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
    vi.mocked(api.dashboard.stats).mockResolvedValue(stats)
    vi.mocked(api.settings.get).mockResolvedValue(settings)
    vi.mocked(api.export.readinessFormat).mockResolvedValue(exportResult())
  })

  it('shows a loading state instead of temporary zero statistics', async () => {
    let resolveStats!: (value: DashboardStats) => void
    vi.mocked(api.dashboard.stats).mockReturnValue(new Promise(resolve => { resolveStats = resolve }))

    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText('Sources', { exact: true })).not.toBeInTheDocument()

    resolveStats(stats)

    expect(await screen.findByText('Sources', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not expose stale quick links while the default profile is paused', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('The default public subscription link is paused.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage export links' })).toHaveAttribute('href', '/export')
    expect(screen.queryByRole('button', { name: 'Copy URL' })).not.toBeInTheDocument()
    expect(screen.queryByText(/\/sub\/token-1\//)).not.toBeInTheDocument()
  })

  it('shows multi-source health and background refresh state on the overview', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      ruleSetHealth: {
        total: 4, valid: 1, warning: 1, invalid: 0, stale: 1, pending: 1,
        lastCheckedAt: '2026-07-18T03:00:00.000Z',
      },
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Rule source health')).toBeInTheDocument()
    expect(screen.getByText('1 valid')).toBeInTheDocument()
    expect(screen.getByText('1 review')).toBeInTheDocument()
    expect(screen.getByText('1 expired')).toBeInTheDocument()
    expect(screen.getByText('1 pending')).toBeInTheDocument()
    expect(screen.getByText(/Background rechecks are enabled/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review routing policies' })).toHaveAttribute('href', '/remote-rule-sets')
  })

  it('aggregates source, rule-set, and export failures into actionable dashboard items', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceRefreshFailureCount: 2,
      defaultExportEnabled: true,
      ruleSetHealth: {
        total: 4, valid: 1, warning: 1, invalid: 1, stale: 1, pending: 0,
      },
    })
    const blocker = {
      client: 'mihomo' as const,
      level: 'unsupported' as const,
      message: '规则引用无效',
      messageEn: 'A rule reference is invalid.',
      remediation: { target: 'rules' as const, id: 'rule-1' },
    }
    vi.mocked(api.export.readinessFormat).mockResolvedValue({
      ...exportResult(),
      warnings: [blocker],
      readiness: { ready: false, blockingWarnings: [blocker] },
    })

    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(await screen.findByText('Blocking export issues: 1')).toBeInTheDocument()
    expect(screen.getByText('Subscription refresh failures: 2')).toBeInTheDocument()
    expect(screen.getByText('Invalid rule-set sources: 1')).toBeInTheDocument()
    expect(screen.getByText('Rule-set sources needing review: 2')).toBeInTheDocument()
    expect(screen.getByText('Contains blockers')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open' }).map(link => link.getAttribute('href'))).toEqual([
      '/sources?attention=refresh',
      '/remote-rule-sets?attention=1',
      '/remote-rule-sets?attention=1',
      '/rules?edit=rule-1',
    ])
  })

  it('uses one format picker and keeps the token-bearing URL out of the page', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByRole('combobox', { name: 'Export Format' })).toHaveValue('mihomo')
    expect(screen.getAllByRole('button', { name: 'Copy URL' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1)
    expect(screen.queryByText(/token-1/)).not.toBeInTheDocument()
    expect(await screen.findByText('Ready to use')).toBeInTheDocument()
    expect(api.export.readinessFormat).toHaveBeenCalledWith('mihomo')
    expect(screen.getByText('Configuration flow')).toBeInTheDocument()
    expect(screen.getAllByText('Complete')).toHaveLength(3)
    expect(screen.getByText('The selected client configuration is structurally valid and ready.')).toBeInTheDocument()
  })

  it('does not claim a subscription URL was copied when clipboard permission is denied', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('permission denied'),
    )
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText('Ready to use')
    await user.click(screen.getByRole('button', { name: 'Copy URL' }))

    expect(await screen.findByText('Could not copy to the clipboard. Check browser permission and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied!' })).not.toBeInTheDocument()
    writeText.mockRestore()
  })

  it('keeps the flow visible before setup and makes source input the next step', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceCount: 0,
      nodeCount: 0,
      enabledNodeCount: 0,
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Configuration flow')).toBeInTheDocument()
    expect(screen.getByText('Add a subscription or manual node before generating a usable configuration.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open next step' })).toHaveAttribute('href', '/sources')
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    expect(api.export.readinessFormat).not.toHaveBeenCalled()
  })

  it('only enables zero-setup source creation after detecting a valid URL', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceCount: 0,
      nodeCount: 0,
      enabledNodeCount: 0,
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    const input = await screen.findByRole('textbox', { name: 'Subscription URL' })
    const submit = screen.getByRole('button', { name: 'Add URL' })
    expect(submit).toBeDisabled()

    await user.type(input, 'not a subscription')
    expect(submit).toBeDisabled()

    await user.type(input, '\nhttps://example.com/sub')
    expect(submit).toBeEnabled()
  })

  it('blocks quick actions when preview diagnostics prove the export is unusable', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    vi.mocked(api.export.readinessFormat).mockResolvedValue(exportResult('unsupported'))
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Export blocked')).toBeInTheDocument()
    expect(screen.getByText('Unsupported node protocol')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/preview?format=mihomo')
    expect(screen.getByText('A compatibility or reference issue must be fixed before export.')).toBeInTheDocument()
  })

  it('prioritizes the authoritative blocker over earlier non-blocking notices', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    const cachedWarning = {
      client: 'mihomo' as const,
      level: 'unsupported' as const,
      message: '缓存源刷新失败',
      messageEn: 'Cached source refresh failed.',
    }
    const graphBlocker = {
      client: 'mihomo' as const,
      level: 'unsupported' as const,
      message: '没有可导出的节点',
      messageEn: 'No renderable nodes are available.',
      remediation: { target: 'nodes' as const },
    }
    vi.mocked(api.export.readinessFormat).mockResolvedValue({
      ...exportResult(),
      warnings: [cachedWarning, graphBlocker],
      readiness: { ready: false, blockingWarnings: [graphBlocker] },
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Export blocked')).toBeInTheDocument()
    expect(screen.getByText(graphBlocker.messageEn)).toBeInTheDocument()
    expect(screen.queryByText(cachedWarning.messageEn)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review nodes' })).toHaveAttribute('href', '/nodes')
    expect(screen.getByRole('link', { name: 'Open next step' })).toHaveAttribute('href', '/nodes')
  })

  it('keeps links disabled until the selected format has been checked', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    let resolvePreview!: (value: ReturnType<typeof exportResult>) => void
    vi.mocked(api.export.readinessFormat).mockReturnValue(new Promise(resolve => { resolvePreview = resolve }))
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Checking export readiness')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()

    resolvePreview(exportResult())
    expect(await screen.findByText('Ready to use')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  })

  it('rechecks readiness when the selected client changes', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    const user = userEvent.setup()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText('Ready to use')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Export Format' }), 'singbox')

    expect(await screen.findByText('Ready to use')).toBeInTheDocument()
    expect(api.export.readinessFormat).toHaveBeenLastCalledWith('singbox')
  })

  it('preserves the selected client when opening the preview journey step', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: true })
    vi.mocked(api.export.readinessFormat).mockResolvedValue(exportResult('partial'))
    const user = userEvent.setup()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    await screen.findByText('Ready with notices')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Export Format' }), 'singbox')

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open next step' })).toHaveAttribute(
        'href',
        '/preview?format=singbox',
      )
    })
  })
})

function exportResult(level?: 'unsupported' | 'partial' | 'convert') {
  const warnings = level ? [{
    client: 'mihomo' as const,
    level,
    message: '不支持的节点协议',
    messageEn: 'Unsupported node protocol',
  }] : []
  return {
    format: 'mihomo' as const,
    capabilityProfile: { id: 'uni-conf-exporter' as const, revision: 1, format: 'mihomo' as const },
    content: 'proxies:\n  - name: Test',
    contentType: 'text/yaml',
    warnings,
    artifactValidation: { format: 'mihomo' as const, kind: 'yaml' as const, valid: true, issues: [] },
    readiness: { ready: level !== 'unsupported', blockingWarnings: level === 'unsupported' ? warnings : [] },
  }
}
