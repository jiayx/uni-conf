import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { SetupGuideDialog } from './SetupGuideDialog'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboard: { stats: vi.fn() },
      sources: { ...actual.api.sources, create: vi.fn() },
    },
  }
})

describe('global setup guide', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    await i18n.changeLanguage('en')
    vi.mocked(api.dashboard.stats).mockResolvedValue({
      sourceCount: 0,
      nodeCount: 0,
      enabledNodeCount: 0,
      collectionCount: 1,
      groupCount: 1,
      ruleCount: 0,
      exportConfigCount: 1,
    })
    vi.mocked(api.sources.create).mockResolvedValue({} as never)
  })

  it('opens globally for a pristine workspace with a concise primary action', async () => {
    render(<MemoryRouter><SetupGuideDialog /></MemoryRouter>)

    expect(await screen.findByRole('dialog', { name: 'Add a subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manual Entry' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage sources' })).toHaveAttribute('href', '/sources')
  })

  it('shows in-place progress after a valid subscription is submitted', async () => {
    vi.mocked(api.sources.create).mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    render(<MemoryRouter><SetupGuideDialog /></MemoryRouter>)

    await user.type(
      await screen.findByRole('textbox', { name: 'Subscription URL' }),
      'https://example.com/sub',
    )
    await user.click(screen.getByRole('button', { name: 'Start setup' }))

    expect(await screen.findByRole('heading', { name: 'Preparing your configuration' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Importing the subscription and generating the base configuration',
    )
    expect(screen.queryByRole('textbox', { name: 'Subscription URL' })).not.toBeInTheDocument()
  })
})
