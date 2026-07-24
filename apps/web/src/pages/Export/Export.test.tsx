import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Export } from './Export'
import { ApiError, api } from '@/lib/api'
import i18n from '@/i18n'
import type { AppSettings, CompatibilityWarning, ExportConfig, ExportResult } from '@uni-conf/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      export: {
        ...actual.api.export,
        listConfigs: vi.fn(),
        readinessFormat: vi.fn(),
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

const configs: ExportConfig[] = [
  {
    id: 'default-mihomo', name: 'Default', format: 'mihomo', token: 'old-default-token', enabled: true,
    includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [],
    createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  },
  {
    id: 'advanced-1', name: 'Mobile', format: 'singbox', token: 'old-mobile-token', enabled: true,
    includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [],
    createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  },
]
const rotatedConfigs = configs.map(config => config.id === 'default-mihomo'
  ? { ...config, token: 'new-default-token' }
  : config)

const cachedRefreshWarning: CompatibilityWarning = {
  client: 'singbox',
  level: 'unsupported',
  message: '订阅源最近刷新失败，继续使用缓存节点',
  messageEn: 'Cached source refresh failed; previously imported nodes remain available.',
}

function previewResult(
  ready: boolean,
  warnings: CompatibilityWarning[] = [cachedRefreshWarning],
  blockingWarnings: CompatibilityWarning[] = ready ? [] : warnings,
): ExportResult {
  return {
    format: 'singbox',
    capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'singbox' },
    content: '{\n  "outbounds": []\n}',
    contentType: 'application/json; charset=utf-8',
    warnings,
    artifactValidation: { format: 'singbox', kind: 'json', valid: true, issues: [] },
    readiness: { ready, blockingWarnings },
  }
}

describe('Export token rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
    vi.mocked(api.export.listConfigs).mockReset().mockResolvedValueOnce(configs).mockResolvedValue(rotatedConfigs)
    vi.mocked(api.export.resetToken).mockResolvedValue(rotatedConfigs[0])
    vi.mocked(api.export.createConfig).mockResolvedValue(configs[1])
    vi.mocked(api.export.updateConfig).mockResolvedValue(configs[0])
    vi.mocked(api.export.deleteConfig).mockResolvedValue()
    vi.mocked(api.export.previewFormat).mockResolvedValue(previewResult(true))
    vi.mocked(api.settings.get).mockResolvedValue({
      ruleSetConversionPolicy: 'strict',
    } as AppSettings)
    vi.mocked(api.export.readinessFormat).mockResolvedValue({
      ...previewResult(true, [], []),
      format: 'mihomo',
      capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
    })
  })

  it('opens the requested advanced export profile from a remediation link', async () => {
    render(<MemoryRouter initialEntries={['/export?edit=advanced-1']}><Export /></MemoryRouter>)

    const dialog = await screen.findByRole('dialog', { name: 'Edit Advanced Export Profile' })
    expect(within(dialog).getByRole('textbox', { name: 'Name (optional)' })).toHaveValue('Mobile')
  })

  it('explains node and DNS capabilities when choosing an export format', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'New Advanced Export Profile' }))
    const dialog = screen.getByRole('dialog', { name: 'New Advanced Export Profile' })
    expect(within(dialog).getByText(/This exporter can serialize 12 node protocols: .*vless/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Fully managed DNS modes: compatible \/ smart \/ fake-ip/)).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Export Format' }), 'nodes_raw')
    expect(within(dialog).getByText(/This exporter can serialize 15 node protocols/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Node subscriptions contain nodes only/)).toBeInTheDocument()
  })

  it('saves a profile-level conversion policy and exposes it on the card', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    expect(within(card).getByText('Conversion: global (Strict completeness)')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Advanced Export Profile' })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Rule-set conversion policy' }),
      'strict',
    )
    expect(within(dialog).getByText(/Block previews, downloads, and subscriptions/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(api.export.updateConfig).toHaveBeenCalledWith('advanced-1', expect.objectContaining({
      ruleSetConversionPolicy: 'strict',
    }))
  })

  it('duplicates a profile scope and policy through the create API so it receives a new token', async () => {
    const inheritedConfigs = configs.map(config => config.id === 'advanced-1'
      ? { ...config, ruleSetConversionPolicy: 'compatible' as const }
      : config)
    vi.mocked(api.export.listConfigs).mockReset().mockResolvedValue(inheritedConfigs)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Duplicate' }))
    const dialog = screen.getByRole('dialog', { name: 'New Advanced Export Profile' })
    expect(within(dialog).getByRole('textbox', { name: 'Name (optional)' })).toHaveValue('Mobile Copy')
    expect(within(dialog).getByRole('combobox', { name: 'Export Format' })).toHaveValue('singbox')
    expect(within(dialog).getByRole('combobox', { name: 'Rule-set conversion policy' })).toHaveValue('compatible')

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(api.export.createConfig).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Mobile Copy',
      format: 'singbox',
      ruleSetConversionPolicy: 'compatible',
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
    }))
    expect(api.export.updateConfig).not.toHaveBeenCalled()
  })

  it('does not close a changed export profile until discard is confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'New Advanced Export Profile' }))
    const dialog = screen.getByRole('dialog', { name: 'New Advanced Export Profile' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (optional)' }), 'Phone')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(dialog).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'New Advanced Export Profile' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('rotates the default export token and reloads subscription URLs', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: 'Reveal links' })).toBeInTheDocument()
    expect(screen.queryByText(/old-default-token/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reveal links' }))
    expect(confirmSpy).toHaveBeenCalledWith('Public subscription links contain an access token. Reveal them temporarily?')
    expect(screen.getAllByText(/old-default-token/).length).toBeGreaterThan(0)

    const resetButtons = await screen.findAllByRole('button', { name: 'Reset Token' })
    await user.click(resetButtons[0])

    expect(confirmSpy).toHaveBeenCalledWith('Reset subscription token? All existing subscriptions using the old token will be invalidated.')
    expect(api.export.resetToken).toHaveBeenCalledWith('default-mihomo')
    expect(await screen.findByRole('status')).toHaveTextContent('Token reset successfully')
    await waitFor(() => expect(api.export.listConfigs).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/old-default-token/)).not.toBeInTheDocument()
    expect(screen.queryByText(/new-default-token/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal links' })).toBeInTheDocument()
  })

  it('reveals an advanced profile link only after confirmation and can hide it again', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const reveal = await screen.findByRole('button', { name: 'Reveal link' })
    expect(screen.queryByText(/old-mobile-token/)).not.toBeInTheDocument()
    await user.click(reveal)

    expect(confirmSpy).toHaveBeenCalledWith('Public subscription links contain an access token. Reveal them temporarily?')
    expect(screen.getByText(/old-mobile-token/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide link' }))
    expect(screen.queryByText(/old-mobile-token/)).not.toBeInTheDocument()
  })

  it('does not rotate a token when the warning is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const resetButtons = await screen.findAllByRole('button', { name: 'Reset Token' })
    await user.click(resetButtons[1])

    expect(api.export.resetToken).not.toHaveBeenCalled()
  })

  it('pauses the default public link and disables its quick actions', async () => {
    const paused = configs.map(config => config.id === 'default-mihomo' ? { ...config, enabled: false } : config)
    vi.mocked(api.export.listConfigs).mockReset().mockResolvedValueOnce(configs).mockResolvedValue(paused)
    vi.mocked(api.export.updateConfig).mockResolvedValue(paused[0])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const pauseButtons = await screen.findAllByRole('button', { name: 'Pause Link' })
    await user.click(pauseButtons[0])

    expect(confirmSpy).toHaveBeenCalledWith('Pause this public subscription link? Connected clients will receive Not Found until it is resumed.')
    expect(api.export.updateConfig).toHaveBeenCalledWith('default-mihomo', { enabled: false })
    expect(await screen.findByRole('status')).toHaveTextContent('Public subscription link paused')
    expect(await screen.findByText(/This public subscription link is paused/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Preview' })[0]).toBeDisabled()
  })

  it('resumes a paused link without a destructive confirmation', async () => {
    const paused = configs.map(config => ({ ...config, enabled: false }))
    vi.mocked(api.export.listConfigs).mockReset().mockResolvedValueOnce(paused).mockResolvedValue(configs)
    vi.mocked(api.export.updateConfig).mockResolvedValue(configs[0])
    const confirmSpy = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const resumeButtons = await screen.findAllByRole('button', { name: 'Resume Link' })
    await user.click(resumeButtons[0])

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.export.updateConfig).toHaveBeenCalledWith('default-mihomo', { enabled: true })
    expect(await screen.findByRole('status')).toHaveTextContent('Public subscription link resumed')
  })

  it('keeps the edit dialog and diagnostic context when saving fails', async () => {
    vi.mocked(api.export.updateConfig).mockRejectedValueOnce(
      new ApiError('Export profile update failed', 409, 'export_profile_conflict', 'request-export-1'),
    )
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Advanced Export Profile' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'Name (optional)' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Travel')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Export profile update failed')
    expect(within(dialog).getByText('export_profile_conflict · request-export-1')).toBeInTheDocument()
    expect(nameInput).toHaveValue('Travel')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(api.export.listConfigs).toHaveBeenCalledTimes(1)
  })

  it('keeps a profile visible and reports diagnostics when deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.export.deleteConfig).mockRejectedValueOnce(
      new ApiError('Export profile deletion failed', 503, 'export_delete_failed', 'request-export-2'),
    )
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Delete export profile Mobile' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete the export profile “Mobile”? Its public subscription link will stop working.',
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Export profile deletion failed')
    expect(screen.getByText('export_delete_failed · request-export-2')).toBeInTheDocument()
    expect(await advancedConfigCard()).toBeInTheDocument()
    expect(api.export.listConfigs).toHaveBeenCalledTimes(1)
  })

  it('shows an initial loading failure instead of silently falling back to an empty page', async () => {
    vi.mocked(api.export.listConfigs).mockReset().mockRejectedValueOnce(
      new ApiError('Export profiles unavailable', 503, 'export_list_failed', 'request-export-3'),
    )
    render(<MemoryRouter><Export /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Export profiles unavailable')
    expect(screen.getByText('export_list_failed · request-export-3')).toBeInTheDocument()
    expect(screen.getByText('Default export is still available')).toBeInTheDocument()
  })

  it('keeps delivery actions enabled for an authoritative non-blocking unsupported notice', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Validate' }))

    expect(await within(card).findByText('Config ready')).toBeInTheDocument()
    expect(within(card).getByText(/1 non-blocking notice/)).toBeInTheDocument()
    expect(within(card).getByText(cachedRefreshWarning.messageEn)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeEnabled()
  })

  it('disables delivery after validation finds a real blocker while keeping diagnosis actions available', async () => {
    const graphBlocker: CompatibilityWarning = {
      client: 'singbox',
      level: 'unsupported',
      message: '没有可导出的节点',
      messageEn: 'No renderable nodes are available.',
    }
    vi.mocked(api.export.previewFormat).mockResolvedValue(
      previewResult(false, [cachedRefreshWarning, graphBlocker], [graphBlocker]),
    )
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Validate' }))

    expect(await within(card).findByText('Config needs attention')).toBeInTheDocument()
    expect(within(card).getByText(/1 blocking issue/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Validate' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Preview' })).toBeEnabled()
  })

  it('shows authoritative readiness and localized warnings in the inline preview', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('Config ready')
    expect(screen.getByRole('dialog')).toHaveTextContent(cachedRefreshWarning.messageEn)
    expect(screen.getByRole('dialog')).not.toHaveTextContent(cachedRefreshWarning.message)
  })

  it('shows exact transformations in the inline preview without duplicating them as warnings', async () => {
    const conversionWarning: CompatibilityWarning = {
      code: 'rule-converted',
      client: 'singbox',
      level: 'convert',
      message: '规则 PORT,443 将等价转换为 PORT,443',
      messageEn: 'Rule PORT,443 will be converted to PORT,443.',
      ruleId: 'rule-port',
      remediation: { target: 'rules', id: 'rule-port' },
      transformation: {
        resource: 'rule',
        action: 'convert',
        source: 'PORT,443',
        target: 'PORT,443',
      },
    }
    vi.mocked(api.export.previewFormat).mockResolvedValue(
      previewResult(true, [conversionWarning, cachedRefreshWarning], []),
    )
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))

    const dialog = await screen.findByRole('dialog')
    const report = within(dialog).getByRole('region', { name: 'Export transformation report' })
    expect(within(report).getAllByText('PORT,443')).toHaveLength(2)
    expect(within(report).getByText(conversionWarning.messageEn)).toBeInTheDocument()
    expect(within(dialog).getAllByText(conversionWarning.messageEn)).toHaveLength(1)
    expect(within(dialog).getByText(cachedRefreshWarning.messageEn)).toBeInTheDocument()
  })

  it('does not allow copying an inline preview that readiness marks as blocked', async () => {
    const graphBlocker: CompatibilityWarning = {
      client: 'singbox',
      level: 'unsupported',
      message: '没有可导出的节点',
      messageEn: 'No renderable nodes are available.',
    }
    vi.mocked(api.export.previewFormat).mockResolvedValue(previewResult(false, [graphBlocker], [graphBlocker]))
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Config needs attention')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })

  it('bounds large inline content while copying and expansion still use the complete config', async () => {
    const content = Array.from({ length: 130 }, (_, index) => `line-${index + 1}`).join('\n')
    vi.mocked(api.export.previewFormat).mockResolvedValue({ ...previewResult(true, [], []), content })
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog')
    const code = dialog.querySelector('pre')
    expect(code).toHaveTextContent('line-120')
    expect(code).not.toHaveTextContent('line-121')
    expect(within(dialog).getByText(/Showing 120\/130 lines/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(content)
    await user.click(within(dialog).getByRole('button', { name: 'Show full config' }))
    expect(code).toHaveTextContent('line-130')
    writeText.mockRestore()
  })

  it('keeps an inline preview open and reports clipboard permission failures', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('permission denied'),
    )
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not copy to the clipboard. Check browser permission and try again.',
    )
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('"outbounds": []')
    writeText.mockRestore()
  })

  it('keeps inline preview diagnostics visible when rechecking temporarily fails', async () => {
    vi.mocked(api.export.previewFormat)
      .mockResolvedValueOnce(previewResult(true, [], []))
      .mockRejectedValueOnce(new Error('Temporary upstream failure'))
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const card = await advancedConfigCard()
    await user.click(within(card).getByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('"outbounds": []')

    await user.click(within(dialog).getByRole('button', { name: 'Refresh' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Temporary upstream failure')
    expect(dialog).toHaveTextContent('"outbounds": []')
    expect(within(dialog).getByText('Previous preview retained')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })

  it('checks default-format readiness before copying its public URL', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const row = await defaultFormatRow('Mihomo / Clash / OpenClash')
    await user.click(within(row).getByRole('button', { name: 'Copy' }))

    expect(await within(row).findByText('Ready to use')).toBeInTheDocument()
    expect(api.export.readinessFormat).toHaveBeenCalledTimes(1)
    expect(api.export.readinessFormat).toHaveBeenCalledWith('mihomo')
    expect(within(row).getByRole('button', { name: 'Copied!' })).toBeEnabled()
  })

  it('does not claim success when copying a checked public URL is denied', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('permission denied'),
    )
    render(<MemoryRouter><Export /></MemoryRouter>)

    const row = await defaultFormatRow('Mihomo / Clash / OpenClash')
    await user.click(within(row).getByRole('button', { name: 'Copy' }))

    expect(await within(row).findByText('Ready to use')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy to the clipboard. Check browser permission and try again.',
    )
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(within(row).queryByRole('button', { name: 'Copied!' })).not.toBeInTheDocument()
    writeText.mockRestore()
  })

  it('blocks default-format delivery actions when the lightweight check finds a blocker', async () => {
    const graphBlocker: CompatibilityWarning = {
      client: 'mihomo',
      level: 'unsupported',
      message: '没有可导出的节点',
      messageEn: 'No renderable nodes are available.',
    }
    vi.mocked(api.export.readinessFormat).mockResolvedValue({
      ...previewResult(false, [graphBlocker], [graphBlocker]),
      format: 'mihomo',
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const row = await defaultFormatRow('Mihomo / Clash / OpenClash')
    await user.click(within(row).getByRole('button', { name: 'Copy' }))

    expect(await within(row).findByText('Export blocked')).toBeInTheDocument()
    expect(within(row).getByText(graphBlocker.messageEn)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Download' })).toBeDisabled()
  })

  it('allows a failed default-format check to be retried', async () => {
    vi.mocked(api.export.readinessFormat).mockRejectedValueOnce(new Error('Readiness service unavailable'))
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const row = await defaultFormatRow('Mihomo / Clash / OpenClash')
    await user.click(within(row).getByRole('button', { name: 'Copy' }))

    expect(await within(row).findByText('Readiness unavailable')).toBeInTheDocument()
    expect(within(row).getByText('Readiness service unavailable')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeEnabled()

    await user.click(within(row).getByRole('button', { name: 'Copy' }))
    expect(await within(row).findByText('Ready to use')).toBeInTheDocument()
    expect(api.export.readinessFormat).toHaveBeenCalledTimes(2)
  })

  it('reuses inline preview readiness for the matching default format', async () => {
    const graphBlocker: CompatibilityWarning = {
      client: 'mihomo',
      level: 'unsupported',
      message: '没有可导出的节点',
      messageEn: 'No renderable nodes are available.',
    }
    vi.mocked(api.export.previewFormat).mockResolvedValue({
      ...previewResult(false, [graphBlocker], [graphBlocker]),
      format: 'mihomo',
      artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
    })
    const user = userEvent.setup()
    render(<MemoryRouter><Export /></MemoryRouter>)

    const row = await defaultFormatRow('Mihomo / Clash / OpenClash')
    await user.click(within(row).getByRole('button', { name: 'Preview' }))

    expect(await within(row).findByText('Export blocked')).toBeInTheDocument()
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(api.export.readinessFormat).not.toHaveBeenCalled()
  })
})

async function advancedConfigCard(): Promise<HTMLElement> {
  const card = (await screen.findByText('Mobile')).closest('[class*="configCard"]')
  if (!(card instanceof HTMLElement)) throw new Error('Advanced export config card not found')
  return card
}

async function defaultFormatRow(label: string): Promise<HTMLElement> {
  const row = (await screen.findByText(label)).closest('[class*="quickFormatRow"]')
  if (!(row instanceof HTMLElement)) throw new Error(`Default format row not found: ${label}`)
  return row
}
