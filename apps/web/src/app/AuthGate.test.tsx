import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from './AuthGate'
import { api, UnauthorizedError } from '@/lib/api'
import { clearStoredApiKey } from '@/lib/auth'
import i18n from '@/i18n'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { check: vi.fn() },
      system: { initialize: vi.fn(async () => ({ initialized: true as const })) },
    },
  }
})

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.auth.check).mockReset()
    clearStoredApiKey()
    void i18n.changeLanguage('en')
  })

  it('renders children when the API has no access key configured', async () => {
    vi.mocked(api.auth.check).mockResolvedValue({ ok: true })

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    )

    expect(await screen.findByText('protected content')).toBeInTheDocument()
  })

  it('shows an unlock form and hides children when the API returns 401', async () => {
    vi.mocked(api.auth.check).mockRejectedValue(new UnauthorizedError())

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    )

    expect(await screen.findByText('UniConf is Protected')).toBeInTheDocument()
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  })

  it('does not gate the app on non-401 errors (e.g. worker unreachable)', async () => {
    vi.mocked(api.auth.check).mockRejectedValue(new Error('network error'))

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    )

    expect(await screen.findByText('protected content')).toBeInTheDocument()
  })

  it('unlocks after entering the correct access key', async () => {
    vi.mocked(api.auth.check)
      .mockRejectedValueOnce(new UnauthorizedError())
      .mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    )

    const input = await screen.findByPlaceholderText('Access key')
    await user.type(input, 'secret')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('protected content')).toBeInTheDocument()
  })

  it('shows an error and stays locked when the entered key is rejected', async () => {
    vi.mocked(api.auth.check)
      .mockRejectedValueOnce(new UnauthorizedError())
      .mockRejectedValueOnce(new UnauthorizedError())
    const user = userEvent.setup()

    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    )

    const input = await screen.findByPlaceholderText('Access key')
    await user.type(input, 'wrong')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Invalid access key')).toBeInTheDocument()
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  })
})
