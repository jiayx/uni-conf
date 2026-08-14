import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Export } from './Export'
import { api } from '@/lib/api'
import i18n from '@/i18n'
import type { AppSettings, ExportConfig, ExportResult } from '@uni-conf/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      export: {
        ...actual.api.export,
        listConfigs: vi.fn(),
        downloadFormat: vi.fn(),
        previewFormat: vi.fn(),
        resetToken: vi.fn(),
        createConfig: vi.fn(),
        updateConfig: vi.fn(),
        deleteConfig: vi.fn(),
      },
      collections: { ...actual.api.collections, list: vi.fn(async () => []) },
      groups: { ...actual.api.groups, list: vi.fn(async () => []) },
      rules: { ...actual.api.rules, list: vi.fn(async () => []) },
      remoteRuleSets: { ...actual.api.remoteRuleSets, list: vi.fn(async () => []) },
      settings: { ...actual.api.settings, get: vi.fn() },
    },
  }
})

const configs: ExportConfig[] = [{
  id: 'default-mihomo',
  name: 'UniConf',
  format: 'mihomo',
  token: 'default-token',
  enabled: true,
  includeCollectionIds: [],
  includeGroupIds: [],
  includeRuleIds: [],
  includeRemoteSetIds: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
}, {
  id: 'advanced-1',
  name: 'Mobile',
  format: 'singbox',
  token: 'mobile-token',
  enabled: true,
  includeCollectionIds: [],
  includeGroupIds: [],
  includeRuleIds: [],
  includeRemoteSetIds: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
}]

const preview: ExportResult = {
  format: 'mihomo',
  capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
  content: 'proxies: []\n',
  contentType: 'text/yaml; charset=utf-8',
  warnings: [],
  artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
  readiness: { ready: true, blockingWarnings: [] },
}

describe('Export', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    vi.mocked(api.export.listConfigs).mockResolvedValue(configs)
    vi.mocked(api.export.previewFormat).mockResolvedValue(preview)
    vi.mocked(api.settings.get).mockResolvedValue({
      ruleSetConversionPolicy: 'compatible',
    } as AppSettings)
  })

  it('copies a public URL directly without generating the export first', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Copy URL' }))[0]!)

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(
      '/sub/default-token/mihomo.yaml?name=UniConf%20%C2%B7%20Mihomo',
    ))
    expect(api.export.previewFormat).not.toHaveBeenCalled()
    writeText.mockRestore()
  })

  it('offers client-specific deep links for full remote profiles', async () => {
    render(<MemoryRouter><Export /></MemoryRouter>)

    const loonLink = await screen.findByRole('link', { name: 'Import into Loon' })
    expect(loonLink).toHaveAttribute(
      'href',
      expect.stringMatching(/^loon:\/\/import\?sub=http%3A%2F%2Flocalhost%3A3000%2Fsub%2Fdefault-token%2Floon\.conf/),
    )

    const singBoxLinks = screen.getAllByRole('link', { name: 'Import into sing-box' })
    expect(singBoxLinks).toHaveLength(2)
    expect(singBoxLinks.at(-1)).toHaveAttribute(
      'href',
      expect.stringMatching(/^sing-box:\/\/import-remote-profile\?url=.*mobile-token.*#Mobile$/),
    )

    expect(screen.queryByRole('link', { name: 'Import into Quantumult X' })).not.toBeInTheDocument()
  })

  it('uses preview as the single diagnostic action for advanced profiles', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(await screen.findByText('Mobile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    const previews = screen.getAllByRole('button', { name: 'Preview Config' })
    await user.click(previews.at(-1)!)

    expect(api.export.previewFormat).toHaveBeenCalledWith('singbox', 'advanced-1')
    expect(await screen.findByRole('dialog', { name: /Mobile/ })).toBeInTheDocument()
    expect(screen.getByText('YAML structure valid')).toBeInTheDocument()
    expect(screen.queryByText('Config ready')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Config Preview' })).not.toBeInTheDocument()
  })

  it('shows every compatibility notice in the export preview', async () => {
    vi.mocked(api.export.previewFormat).mockResolvedValueOnce({
      ...preview,
      warnings: Array.from({ length: 4 }, (_, index) => ({
        client: 'mihomo',
        level: 'unsupported',
        message: `提示 ${index + 1}`,
        messageEn: `Notice ${index + 1}`,
      })),
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Preview Mihomo / Clash.Meta config' }))

    for (let index = 1; index <= 4; index += 1) {
      expect(await screen.findByText(`Notice ${index}`)).toBeInTheDocument()
    }
  })

  it('reveals and hides a subscription URL without a confirmation step', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(screen.queryByText(/mobile-token/)).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Show Link' }))
    expect(screen.getByText(/mobile-token/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide link' }))
    expect(screen.queryByText(/mobile-token/)).not.toBeInTheDocument()
  })

  it('shows a scannable QR code for each subscription URL', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Scan to Add' })).at(-1)!)

    expect(screen.getByRole('dialog', { name: 'Mobile Subscription QR Code' })).toBeInTheDocument()
    expect(screen.getByTitle('Subscription URL QR code')).toBeInTheDocument()
  })

  it('names the affected export profile in subscription and token confirmations', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Pause Subscription' })).at(-1)!)
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Mobile.*all public links/s))

    await user.click(screen.getAllByRole('button', { name: 'Reset Token' }).at(-1)!)
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Mobile.*all existing public links/is))
  })

  it('updates a changed profile without reloading unrelated export data', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.export.updateConfig).mockResolvedValue({ ...configs[1]!, enabled: false })
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Pause Subscription' })).at(-1)!)

    await waitFor(() => expect(api.export.updateConfig).toHaveBeenCalledWith(
      'advanced-1',
      { enabled: false },
    ))
    expect(api.export.listConfigs).toHaveBeenCalledTimes(1)
    expect(api.collections.list).toHaveBeenCalledTimes(1)
    expect(api.groups.list).toHaveBeenCalledTimes(1)
    expect(api.rules.list).toHaveBeenCalledTimes(1)
    expect(api.remoteRuleSets.list).toHaveBeenCalledTimes(1)
    expect(api.settings.get).toHaveBeenCalledTimes(1)
  })

  it('shows guidance that changes with the selected export format', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'New Advanced Export Profile' }))
    expect(screen.getByText(/Exportable node protocols:/)).toHaveTextContent(/global FakeIP policy/)
    expect(screen.queryByLabelText('DNS upstreams')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Export Format'), 'nodes_base64')
    expect(screen.getByText(/Exports nodes only/)).toHaveTextContent(/without DNS, policy groups, or routing rules/)
  })
})
