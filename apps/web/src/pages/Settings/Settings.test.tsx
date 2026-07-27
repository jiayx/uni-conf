import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { ApiError, api } from '@/lib/api'
import i18n from '@/i18n'
import type { AppSettings } from '@uni-conf/types'
import { MAX_BACKUP_FILE_BYTES } from '@uni-conf/shared'

const settings = vi.hoisted((): AppSettings => ({
  language: 'en', theme: 'system', unmatchedTrafficPolicy: 'proxy', routingPolicyScenarios: ['ai-development', 'streaming', 'diagnostics'],
  exportNodeNamingMode: 'smart', showCompatibilityWarnings: true, enableAutoRefresh: true,
  ruleSetConversionPolicy: 'compatible',
  autoRefreshInterval: 1440, autoNodeGroupsEnabled: true, autoNodeGroupTypes: ['url-test'],
  autoNodeGroupIncludeFlag: true,
}))
const actions = vi.hoisted(() => Object.fromEntries([
  'setLanguage', 'setTheme', 'setExportNodeNamingMode', 'setShowCompatibilityWarnings',
  'setRuleSetConversionPolicy',
  'setEnableAutoRefresh', 'setAutoRefreshInterval', 'setAutoNodeGroupsEnabled', 'setAutoNodeGroupTypes',
  'setAutoNodeGroupIncludeFlag', 'applySettings',
].map((name) => [name, vi.fn()])))

vi.mock('@/store/settings.store', () => ({ useSettingsStore: () => ({ ...settings, ...actions }) }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        get: vi.fn(), update: vi.fn(), exportData: vi.fn(), validateImportData: vi.fn(),
        importData: vi.fn(), clearData: vi.fn(),
      },
    },
  }
})

describe('Settings data safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
    vi.mocked(api.settings.get).mockResolvedValue(settings)
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  it('validates an uploaded backup before destructive restore', async () => {
    vi.mocked(api.settings.validateImportData).mockResolvedValue({
      version: 6, totalRows: 4, tables: { sources: 1, nodes: 3 }, containsSensitiveData: true,
    })
    vi.mocked(api.settings.importData).mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { container } = render(<Settings />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await waitForImportReady()

    await user.upload(input, new File([JSON.stringify({ version: 6, tables: {} })], 'backup.json', { type: 'application/json' }))

    expect(api.settings.validateImportData).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('4 rows'))
    expect(api.settings.importData).toHaveBeenCalledOnce()
    expect(await screen.findByText('Data imported successfully')).toBeInTheDocument()
    expect(api.settings.get).toHaveBeenCalledTimes(2)
    expect(actions['applySettings']).toHaveBeenLastCalledWith(settings)
  })

  it('warns that plaintext exports contain credentials', async () => {
    vi.mocked(api.settings.exportData).mockResolvedValue(new Blob(['{}'], { type: 'application/json' }))
    const createObjectURL = vi.fn(() => 'blob:backup')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const user = userEvent.setup()
    render(<Settings />)

    await user.click(screen.getByRole('button', { name: 'Export All Data' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('node passwords'))
    expect(api.settings.exportData).toHaveBeenCalledOnce()
  })

  it('rejects oversized backups before reading or validating them', async () => {
    const text = vi.fn()
    const oversizedFile = { name: 'huge.json', size: MAX_BACKUP_FILE_BYTES + 1, text } as unknown as File
    const { container } = render(<Settings />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await waitForImportReady()

    fireEvent.change(input, { target: { files: [oversizedFile] } })

    expect(await screen.findByText('Backup file must not exceed 25 MiB.')).toBeInTheDocument()
    expect(text).not.toHaveBeenCalled()
    expect(api.settings.validateImportData).not.toHaveBeenCalled()
  })

  it('keeps restore failures diagnosable and does not reload settings after a rejected import', async () => {
    vi.mocked(api.settings.validateImportData).mockResolvedValue({
      version: 6, totalRows: 1, tables: { sources: 1 }, containsSensitiveData: true,
    })
    vi.mocked(api.settings.importData).mockRejectedValueOnce(
      new ApiError('Backup restore failed', 409, 'backup_conflict', 'request-backup-1'),
    )
    const user = userEvent.setup()
    const { container } = render(<Settings />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await waitForImportReady()

    await user.upload(input, new File([JSON.stringify({ version: 6, tables: {} })], 'backup.json', { type: 'application/json' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Backup restore failed')
    expect(screen.getByText('backup_conflict · request-backup-1')).toBeInTheDocument()
    expect(api.settings.get).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Import Data' })).toBeEnabled()
  })

  it('reloads authoritative settings after clearing all data', async () => {
    const resetSettings = {
      ...settings,
      language: 'en' as const,
      theme: 'system' as const,
      ruleSetConversionPolicy: 'compatible' as const,
    }
    vi.mocked(api.settings.get).mockResolvedValueOnce(settings).mockResolvedValueOnce(resetSettings)
    vi.mocked(api.settings.clearData).mockResolvedValue()
    const user = userEvent.setup()
    render(<Settings />)

    await user.click(screen.getByRole('button', { name: 'Clear All Data' }))

    expect(api.settings.clearData).toHaveBeenCalledOnce()
    expect(await screen.findByText('Data cleared')).toBeInTheDocument()
    expect(api.settings.get).toHaveBeenCalledTimes(2)
    expect(actions['applySettings']).toHaveBeenLastCalledWith(resetSettings)
  })

  it('persists the strict rule-set conversion policy with clear risk guidance', async () => {
    vi.mocked(api.settings.update).mockResolvedValue({ ...settings, ruleSetConversionPolicy: 'strict' })
    const user = userEvent.setup()
    render(<Settings />)

    await user.click(screen.getByRole('button', { name: 'Strict completeness' }))

    expect(api.settings.update).toHaveBeenCalledWith({ ruleSetConversionPolicy: 'strict' })
    expect(actions['applySettings']).toHaveBeenCalledWith({ ...settings, ruleSetConversionPolicy: 'strict' })
    expect(screen.getByText(/When an export profile has no override/)).toBeInTheDocument()
  })

  it('keeps the authoritative selection and shows diagnostics when a setting update fails', async () => {
    vi.mocked(api.settings.update).mockRejectedValueOnce(
      new ApiError('Settings update failed', 409, 'settings_conflict', 'request-settings-1'),
    )
    const user = userEvent.setup()
    render(<Settings />)

    const strictButton = screen.getByRole('button', { name: 'Strict completeness' })
    await user.click(strictButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings update failed')
    expect(screen.getByText('settings_conflict · request-settings-1')).toBeInTheDocument()
    expect(strictButton).toHaveAttribute('aria-pressed', 'false')
    expect(actions['setRuleSetConversionPolicy']).not.toHaveBeenCalled()
    expect(strictButton).toBeEnabled()
  })

  it('prevents overlapping global setting mutations while one save is pending', async () => {
    let resolveUpdate: ((value: AppSettings) => void) | undefined
    vi.mocked(api.settings.update).mockImplementationOnce(() => new Promise(resolve => {
      resolveUpdate = resolve
    }))
    const user = userEvent.setup()
    render(<Settings />)

    await user.click(screen.getByRole('button', { name: 'Strict completeness' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saving...')
    const darkButton = screen.getByRole('button', { name: 'Dark' })
    expect(darkButton).toBeDisabled()
    await user.click(darkButton)
    expect(api.settings.update).toHaveBeenCalledTimes(1)

    resolveUpdate?.({ ...settings, ruleSetConversionPolicy: 'strict' })
    await screen.findByRole('button', { name: 'Strict completeness' })
    expect(await screen.findByRole('button', { name: 'Dark' })).toBeEnabled()
  })

  it('blocks mutations until the initial authoritative settings request settles', async () => {
    let resolveSettings: ((value: AppSettings) => void) | undefined
    vi.mocked(api.settings.get).mockReset().mockImplementationOnce(() => new Promise(resolve => {
      resolveSettings = resolve
    }))
    const user = userEvent.setup()
    render(<Settings />)

    const strictButton = screen.getByRole('button', { name: 'Strict completeness' })
    expect(strictButton).toBeDisabled()
    await user.click(strictButton)
    expect(api.settings.update).not.toHaveBeenCalled()

    resolveSettings?.(settings)
    await waitFor(() => expect(strictButton).toBeEnabled())
  })

  it('restores the authoritative refresh interval when persistence fails', async () => {
    vi.mocked(api.settings.update).mockRejectedValueOnce(
      new ApiError('Interval update failed', 503, 'settings_unavailable', 'request-settings-2'),
    )
    const user = userEvent.setup()
    render(<Settings />)
    const interval = await screen.findByRole('spinbutton', { name: 'Default subscription refresh interval (minutes)' })
    await waitFor(() => expect(interval).toBeEnabled())

    await user.clear(interval)
    await user.type(interval, '30')
    await user.tab()

    expect(await screen.findByRole('alert')).toHaveTextContent('Interval update failed')
    expect(interval).toHaveValue(1440)
    expect(screen.getByText('settings_unavailable · request-settings-2')).toBeInTheDocument()
  })

  it('explains the actual scope of automatic refresh', async () => {
    render(<Settings />)

    expect(await screen.findByText('Auto refresh subscriptions')).toBeInTheDocument()
    expect(screen.getByText(/only refreshes remote subscriptions/)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Default subscription refresh interval (minutes)' })).toBeInTheDocument()
  })
})

async function waitForImportReady(): Promise<void> {
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Import Data' })).toBeEnabled(),
    { timeout: 5000 },
  )
}
