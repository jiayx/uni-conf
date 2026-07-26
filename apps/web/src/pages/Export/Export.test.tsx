import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  name: 'Default',
  format: 'mihomo',
  dnsMode: 'smart',
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
  dnsMode: 'fake-ip',
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

    await user.click((await screen.findAllByRole('button', { name: 'Copy' }))[0]!)

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/sub/default-token/mihomo.yaml'))
    expect(api.export.previewFormat).not.toHaveBeenCalled()
    writeText.mockRestore()
  })

  it('uses preview as the single diagnostic action for advanced profiles', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(await screen.findByText('Mobile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    const previews = screen.getAllByRole('button', { name: 'Preview' })
    await user.click(previews.at(-1)!)

    expect(api.export.previewFormat).toHaveBeenCalledWith('singbox', 'advanced-1')
    expect(await screen.findByRole('dialog', { name: /Mobile/ })).toBeInTheDocument()
  })

  it('updates the default export DNS strategy directly from its card', async () => {
    const user = userEvent.setup()
    vi.mocked(api.export.updateConfig).mockResolvedValue({
      ...configs[0]!,
      dnsMode: 'fake-ip',
    })
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.selectOptions(await screen.findByLabelText('DNS Strategy'), 'fake-ip')

    expect(api.export.updateConfig).toHaveBeenCalledWith('default-mihomo', { dnsMode: 'fake-ip' })
  })

  it('reveals and hides a subscription URL without a confirmation step', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(screen.queryByText(/mobile-token/)).not.toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: /Reveal/ })).at(-1)!)
    expect(screen.getByText(/mobile-token/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /Hide/ }).at(-1)!)
    expect(screen.queryByText(/mobile-token/)).not.toBeInTheDocument()
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

  it('shows guidance that changes with the selected export format', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'New Advanced Export Profile' }))
    expect(screen.getByText(/Exportable node protocols:/)).toHaveTextContent(/Available DNS strategies:/)

    await user.selectOptions(screen.getByLabelText('Export Format'), 'nodes_base64')
    expect(screen.getByText(/Exports nodes only/)).toHaveTextContent(/without DNS, policy groups, or routing rules/)
  })
})
