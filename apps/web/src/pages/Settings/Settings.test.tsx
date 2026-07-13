import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'
import { api } from '@/lib/api'
import i18n from '@/i18n'
import type { AppSettings } from '@uni-conf/types'

const settings = vi.hoisted((): AppSettings => ({
  language: 'en', theme: 'system', routingPolicyTemplate: 'common', dnsMode: 'smart',
  exportNodeNamingMode: 'smart', showCompatibilityWarnings: true, enableAutoRefresh: true,
  autoRefreshInterval: 1440, autoNodeGroupsEnabled: true, autoNodeGroupTypes: ['url-test'],
  autoNodeGroupIncludeFlag: true,
}))
const actions = vi.hoisted(() => Object.fromEntries([
  'setLanguage', 'setTheme', 'setDnsMode', 'setExportNodeNamingMode', 'setShowCompatibilityWarnings',
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
      version: 2, totalRows: 4, tables: { sources: 1, nodes: 3 }, containsSensitiveData: true,
    })
    vi.mocked(api.settings.importData).mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { container } = render(<Settings />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, new File([JSON.stringify({ version: 2, tables: {} })], 'backup.json', { type: 'application/json' }))

    expect(api.settings.validateImportData).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('4 rows'))
    expect(api.settings.importData).toHaveBeenCalledOnce()
    expect(await screen.findByText('Data imported successfully')).toBeInTheDocument()
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
})
