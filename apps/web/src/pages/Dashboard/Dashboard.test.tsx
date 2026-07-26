import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Dashboard } from './Dashboard'
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
      export: { ...actual.api.export, downloadFormat: vi.fn() },
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
  defaultExportFormat: 'mihomo',
  defaultExportEnabled: true,
}

describe('Dashboard', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    vi.mocked(api.dashboard.stats).mockResolvedValue(stats)
  })

  it('shows direct quick actions without running an export preflight', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByRole('combobox', { name: 'Export Format' })).toHaveValue('mihomo')
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(screen.queryByText(/token-1/)).not.toBeInTheDocument()
  })

  it('shows only persisted actionable failures', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceRefreshFailureCount: 2,
      ruleSetHealth: {
        total: 4,
        valid: 0,
        warning: 1,
        invalid: 1,
        stale: 1,
        pending: 1,
      },
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('Subscription refresh failures: 2')).toBeInTheDocument()
    expect(screen.getByText('Invalid rule-set sources: 1')).toBeInTheDocument()
    expect(screen.queryByText('Rule source health')).not.toBeInTheDocument()
  })

  it('offers setup instead of quick export when no data exists', async () => {
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      ...stats,
      sourceCount: 0,
      nodeCount: 0,
      enabledNodeCount: 0,
    })
    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: 'Start setup' })).toBeInTheDocument()
    expect(screen.queryByText('Quick Export')).not.toBeInTheDocument()
  })
})
