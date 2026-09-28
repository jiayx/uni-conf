import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Dashboard } from './Dashboard'
import { SetupGuideDialog } from '@/components/onboarding/SetupGuideDialog/SetupGuideDialog'
import { api } from '@/lib/api'
import i18n from '@/i18n'
import type { DashboardStats } from '@uni-conf/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboard: { stats: vi.fn() },
    },
  }
})

const stats: DashboardStats = {
  sourceCount: 1,
  nodeCount: 1,
  enabledNodeCount: 1,
  collectionCount: 1,
  groupCount: 1,
  ruleCount: 1,
  exportConfigCount: 1,
  defaultExportToken: 'token-1',
  defaultExportName: 'UniConf',
  defaultExportFormat: 'mihomo',
  defaultExportEnabled: true,
}

describe('Dashboard', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    await i18n.changeLanguage('en')
    vi.mocked(api.dashboard.stats).mockResolvedValue(stats)
  })

  it('copies the universal configuration link and links to all export options', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Copy subscription link' }))
    expect(writeText).toHaveBeenLastCalledWith('http://localhost:3000/sub/token-1')
    expect(screen.getByRole('link', { name: 'More export options' })).toHaveAttribute('href', '/export')
    expect(screen.queryByText(/token-1/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'QR code' }))
    expect(screen.getByRole('dialog', { name: 'UniConf Subscription QR Code' })).toBeInTheDocument()
    expect(screen.getByTitle('Subscription URL QR code')).toBeInTheDocument()
    writeText.mockRestore()
  })

  it('hides subscription actions when the default profile is paused', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({ ...stats, defaultExportEnabled: false })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)
    expect(await screen.findByText('The default public subscription link is paused.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy subscription link' })).not.toBeInTheDocument()
  })

  it('shows only persisted actionable failures', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceRefreshFailureCount: 2,
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Subscription refresh failures: 2')).toBeInTheDocument()
  })

  it('offers setup instead of quick export when no data exists', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceCount: 0,
      nodeCount: 0,
      enabledNodeCount: 0,
    })
    render(
      <MemoryRouter>
        <Dashboard />
        <SetupGuideDialog />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Start setup' })).toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: 'Add a subscription' })).toBeInTheDocument()
    expect(screen.queryByText('Quick Export')).not.toBeInTheDocument()
    expect(api.dashboard.stats).toHaveBeenCalledTimes(1)
  })
})
