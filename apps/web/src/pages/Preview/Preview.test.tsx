import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { Preview } from './Preview'
import { api } from '@/lib/api'
import i18n from '@/i18n'
import type { ExportFormat } from '@uni-conf/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      export: {
        ...actual.api.export,
        listConfigs: vi.fn(async () => []),
        previewFormat: vi.fn(),
      },
    },
  }
})

describe('Preview artifact validation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(api.export.listConfigs).mockResolvedValue([])
    await i18n.changeLanguage('en')
  })

  it('shows that the generated structure passed runtime validation', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      content: 'proxies:\n  - name: Node\n',
      contentType: 'text/yaml; charset=utf-8',
      warnings: [],
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })

    render(<MemoryRouter><Preview /></MemoryRouter>)

    expect(await screen.findByText('YAML structure valid')).toBeInTheDocument()
    expect(screen.getByText('mihomo capability profile r1')).toHaveAttribute(
      'title',
      'This is the UniConf exporter capability revision used to generate the config, not the target client app version.'
    )
    expect(screen.getByText('Config ready')).toBeInTheDocument()
  })

  it('shows a failed artifact check as a blocking preview result', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      content: 'proxies: []\n',
      contentType: 'text/yaml; charset=utf-8',
      artifactValidation: {
        format: 'mihomo',
        kind: 'yaml',
        valid: false,
        issues: [{ code: 'empty_section', path: 'proxies', message: 'proxies 数组为空', messageEn: 'The proxies array is empty.' }],
      },
      warnings: [{
        client: 'mihomo',
        level: 'unsupported',
        message: '导出结果结构校验失败：proxies 数组为空',
        messageEn: 'Export artifact validation failed: The proxies array is empty.',
      }],
      readiness: {
        ready: false,
        blockingWarnings: [{
          client: 'mihomo', level: 'unsupported', message: '结构无效', messageEn: 'Invalid structure',
        }],
      },
    })

    render(<MemoryRouter><Preview /></MemoryRouter>)

    expect(await screen.findByText('Structure invalid (1 issues)')).toBeInTheDocument()
    expect(screen.getByText('Config needs attention')).toBeInTheDocument()
    expect(screen.getByText('Export artifact validation failed: The proxies array is empty.')).toBeInTheDocument()
    expect(screen.queryByText('导出结果结构校验失败：proxies 数组为空')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
  })

  it('does not mislabel a non-blocking unsupported diagnostic as a blocker', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      content: 'proxies:\n  - name: Node\n',
      contentType: 'text/yaml; charset=utf-8',
      warnings: [{
        client: 'mihomo', level: 'unsupported',
        message: '订阅源最近刷新失败，继续使用缓存节点',
        messageEn: 'Cached source refresh failed; previously imported nodes remain available.',
        remediation: { target: 'sources', id: 'source-1' },
      }],
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })

    render(<MemoryRouter><Preview /></MemoryRouter>)

    expect(await screen.findByText('Config ready')).toBeInTheDocument()
    expect(screen.getByText(/1 non-blocking notice/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', '/sources?edit=source-1')
  })

  it('renders a bounded large preview until the user explicitly expands it', async () => {
    const content = Array.from({ length: 520 }, (_, index) => `line-${index + 1}`).join('\n')
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      content,
      contentType: 'text/yaml; charset=utf-8',
      warnings: [],
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<MemoryRouter><Preview /></MemoryRouter>)

    const expand = await screen.findByRole('button', { name: 'Show full config' })
    const code = document.querySelector('pre')
    expect(code).toHaveTextContent('line-500')
    expect(code).not.toHaveTextContent('line-501')
    expect(screen.getByText(/Showing 500\/520 lines/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(content)

    await user.click(expand)
    expect(code).toHaveTextContent('line-520')
    expect(screen.getByRole('button', { name: 'Show compact preview' })).toHaveAttribute('aria-expanded', 'true')
    writeText.mockRestore()
  })

  it('keeps preview content available and reports a clipboard write failure', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      content: 'proxies:\n  - name: Node\n',
      contentType: 'text/yaml; charset=utf-8',
      warnings: [],
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('permission denied'),
    )
    render(<MemoryRouter><Preview /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy to the clipboard. Check browser permission and try again.',
    )
    expect(document.querySelector('pre')).toHaveTextContent('name: Node')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    writeText.mockRestore()
  })

  it('keeps the last successful preview visible when a manual recheck fails', async () => {
    const initial = {
      format: 'mihomo' as const,
      capabilityProfile: { id: 'uni-conf-exporter' as const, revision: 1, format: 'mihomo' as const },
      content: 'proxies:\n  - name: Stable Node\n',
      contentType: 'text/yaml; charset=utf-8',
      warnings: [],
      artifactValidation: { format: 'mihomo' as const, kind: 'yaml' as const, valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    }
    vi.mocked(api.export.previewFormat)
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('Temporary upstream failure'))
      .mockResolvedValueOnce({ ...initial, content: 'proxies:\n  - name: Recovered Node\n' })
    const user = userEvent.setup()
    render(<MemoryRouter><Preview /></MemoryRouter>)

    await screen.findByRole('button', { name: 'Refresh' })
    expect(document.querySelector('pre')).toHaveTextContent('Stable Node')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary upstream failure')
    expect(document.querySelector('pre')).toHaveTextContent('Stable Node')
    expect(screen.getByText('Previous preview retained')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(document.querySelector('pre')).toHaveTextContent('Recovered Node'))
    expect(document.querySelector('pre')).not.toHaveTextContent('Stable Node')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
  })

  it('ignores an older preview response after the target client changes', async () => {
    const mihomo = deferred<Awaited<ReturnType<typeof api.export.previewFormat>>>()
    const singbox = deferred<Awaited<ReturnType<typeof api.export.previewFormat>>>()
    vi.mocked(api.export.previewFormat).mockImplementation(format => (
      format === 'singbox' ? singbox.promise : mihomo.promise
    ))
    const user = userEvent.setup()
    render(<MemoryRouter><Preview /></MemoryRouter>)

    await waitFor(() => expect(api.export.previewFormat).toHaveBeenCalledWith('mihomo', undefined))
    await user.click(screen.getByRole('button', { name: 'sing-box' }))
    await waitFor(() => expect(api.export.previewFormat).toHaveBeenCalledWith('singbox', undefined))

    await act(async () => {
      singbox.resolve({
        format: 'singbox',
        capabilityProfile: { id: 'uni-conf-exporter', revision: 18, format: 'singbox' },
        content: '{\n  "outbounds": [{"tag": "singbox-current"}]\n}',
        contentType: 'application/json; charset=utf-8',
        warnings: [],
        artifactValidation: { format: 'singbox', kind: 'json', valid: true, issues: [] },
        readiness: { ready: true, blockingWarnings: [] },
      })
    })
    await waitFor(() => expect(document.querySelector('pre')).toHaveTextContent('singbox-current'))

    await act(async () => {
      mihomo.resolve({
        format: 'mihomo',
        capabilityProfile: { id: 'uni-conf-exporter', revision: 18, format: 'mihomo' },
        content: 'proxies:\n  - name: stale-mihomo\n',
        contentType: 'text/yaml; charset=utf-8',
        warnings: [],
        artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
        readiness: { ready: true, blockingWarnings: [] },
      })
    })

    expect(document.querySelector('pre')).toHaveTextContent('singbox-current')
    expect(document.querySelector('pre')).not.toHaveTextContent('stale-mihomo')
    expect(screen.getByText('singbox capability profile r18')).toBeInTheDocument()
  })

  it('binds an advanced export profile to its target client in the address bar', async () => {
    vi.mocked(api.export.listConfigs).mockResolvedValue([{
      id: 'advanced-1',
      name: 'Mobile',
      format: 'singbox',
      token: 'profile-token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }])
    vi.mocked(api.export.previewFormat).mockImplementation(async (format) => {
      const exportFormat = format as ExportFormat
      return {
        format: exportFormat,
        capabilityProfile: { id: 'uni-conf-exporter', revision: 18, format: exportFormat },
        content: `preview:${exportFormat}`,
        contentType: 'text/plain; charset=utf-8',
        warnings: [],
        artifactValidation: { format: exportFormat, kind: 'ini', valid: true, issues: [] },
        readiness: { ready: true, blockingWarnings: [] },
      }
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/preview?attention=1']}>
        <Preview />
        <LocationProbe />
      </MemoryRouter>,
    )

    const singboxTab = screen.getByRole('button', { name: 'sing-box' })
    const mihomoTab = screen.getByRole('button', { name: 'Mihomo' })
    expect(mihomoTab).toHaveAttribute('aria-pressed', 'true')

    const selector = await screen.findByRole('combobox', { name: 'Export profile' })
    await user.selectOptions(selector, 'advanced-1')

    const locationSearch = await screen.findByTestId('location-search')
    expect(locationSearch).toHaveTextContent('attention=1')
    expect(locationSearch).toHaveTextContent('format=singbox')
    expect(locationSearch).toHaveTextContent('configId=advanced-1')
    expect(singboxTab).toHaveAttribute('aria-pressed', 'true')
    expect(mihomoTab).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(api.export.previewFormat).toHaveBeenCalledWith(
      'singbox',
      'advanced-1',
    ))

    await user.click(mihomoTab)

    expect(screen.getByTestId('location-search')).toHaveTextContent(
      '?attention=1&format=mihomo',
    )
    expect(selector).toHaveValue('')
  })

  it('reports and retries export-profile loading without blocking the default preview', async () => {
    vi.mocked(api.export.listConfigs)
      .mockRejectedValueOnce(new Error('Profile service unavailable'))
      .mockResolvedValueOnce([{
        id: 'advanced-1',
        name: 'Mobile',
        format: 'singbox',
        token: 'profile-token',
        enabled: true,
        includeCollectionIds: [],
        includeGroupIds: [],
        includeRuleIds: [],
        includeRemoteSetIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }])
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 18, format: 'mihomo' },
      content: 'proxies:\n  - name: Default still works\n',
      contentType: 'text/yaml; charset=utf-8',
      warnings: [],
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Preview /></MemoryRouter>)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load export profiles')
    expect(alert).toHaveTextContent('Profile service unavailable')
    await screen.findByText('Config ready')
    expect(document.querySelector('pre')).toHaveTextContent('Default still works')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('option', { name: 'Mobile (singbox)' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Profile service unavailable')).not.toBeInTheDocument())
    expect(api.export.listConfigs).toHaveBeenCalledTimes(2)
  })

  it('shows a filterable source-to-target transformation report', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      format: 'shadowrocket',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 18, format: 'shadowrocket' },
      content: '[Rule]\nDST-PORT,443,DIRECT\n',
      contentType: 'text/plain; charset=utf-8',
      warnings: [
        {
          code: 'rule-converted',
          client: 'shadowrocket',
          level: 'convert',
          message: '规则 PORT,443 将等价转换为 DST-PORT,443',
          messageEn: 'Rule PORT,443 will be converted to DST-PORT,443.',
          ruleId: 'rule-port',
          remediation: { target: 'rules', id: 'rule-port' },
          transformation: {
            resource: 'rule',
            action: 'convert',
            source: 'PORT,443',
            target: 'DST-PORT,443',
          },
        },
        {
          code: 'rule-unsupported',
          client: 'shadowrocket',
          level: 'unsupported',
          message: '规则 NETWORK,icmp 不兼容',
          messageEn: 'Rule NETWORK,icmp is unsupported.',
          ruleId: 'rule-network',
          remediation: { target: 'rules', id: 'rule-network' },
          transformation: {
            resource: 'rule',
            action: 'skip',
            source: 'NETWORK,icmp',
          },
        },
      ],
      artifactValidation: { format: 'shadowrocket', kind: 'ini', valid: true, issues: [] },
      readiness: { ready: true, blockingWarnings: [] },
    })
    const user = userEvent.setup()

    render(<MemoryRouter><Preview /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Export transformation report' })).toBeInTheDocument()
    expect(screen.getByText('PORT,443')).toBeInTheDocument()
    expect(screen.getByText('DST-PORT,443')).toBeInTheDocument()
    expect(screen.getByText('NETWORK,icmp')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Not exported 1' }))

    expect(screen.queryByText('PORT,443')).not.toBeInTheDocument()
    expect(screen.getByText('NETWORK,icmp')).toBeInTheDocument()
    expect(screen.getByText('Not written to target config')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute(
      'href',
      '/rules?edit=rule-network',
    )
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => {
    resolve = next
  })
  return { promise, resolve }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location-search">{location.search}</span>
}
