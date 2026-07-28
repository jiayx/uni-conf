import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { openSetupGuide } from '@/core/onboarding/setup-guide'
import { SetupGuideDialog } from './SetupGuideDialog'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      sources: { ...actual.api.sources, create: vi.fn() },
    },
  }
})

describe('global setup guide', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    await i18n.changeLanguage('en')
    vi.mocked(api.sources.create).mockResolvedValue({} as never)
  })

  it('opens when requested with a concise primary action', async () => {
    render(<MemoryRouter><SetupGuideDialog /></MemoryRouter>)
    act(() => openSetupGuide())

    expect(await screen.findByRole('dialog', { name: 'Add a subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manual Entry' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage sources' })).toHaveAttribute('href', '/sources')
  })

  it('shows in-place progress after a valid subscription is submitted', async () => {
    vi.mocked(api.sources.create).mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    render(<MemoryRouter><SetupGuideDialog /></MemoryRouter>)
    act(() => openSetupGuide())

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
