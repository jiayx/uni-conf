import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import i18n from '@/i18n'
import { ApiError } from '@/lib/api'
import { ErrorNotice } from './ErrorNotice'

describe('ErrorNotice', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en')
  })

  it('shows a direct remediation link for a structured dependency error', () => {
    const error = new ApiError(
      'group is targeted by rule: Work Rule',
      409,
      'resource_in_use',
      'request-1',
      {
        dependency: { type: 'rule', id: 'rule-1', name: 'Work Rule' },
        remediation: { target: 'rules', id: 'rule-1' },
      },
    )

    render(<MemoryRouter><ErrorNotice error={error} /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent('Referenced by: Work Rule')
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute(
      'href',
      '/rules?edit=rule-1',
    )
    expect(screen.getByText('resource_in_use · request-1')).toBeInTheDocument()
  })

  it('keeps ordinary errors free of dependency UI', () => {
    render(<MemoryRouter><ErrorNotice error={new Error('plain failure')} /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent('plain failure')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows every blocking dependency with its own remediation', () => {
    const error = new ApiError(
      'group is included by export profile: Mobile',
      409,
      'resource_in_use',
      undefined,
      {
        dependency: { type: 'export-profile', id: 'export-1', name: 'Mobile' },
        remediation: { target: 'export', id: 'export-1' },
        dependencies: [
          {
            type: 'export-profile',
            id: 'export-1',
            name: 'Mobile',
            remediation: { target: 'export', id: 'export-1' },
          },
          {
            type: 'rule',
            id: 'rule-1',
            name: 'Work Rule',
            remediation: { target: 'rules', id: 'rule-1' },
          },
        ],
      },
    )

    render(<MemoryRouter><ErrorNotice error={error} /></MemoryRouter>)

    expect(screen.getByText('2 blocking references')).toBeInTheDocument()
    expect(screen.getByText('Referenced by: Mobile')).toBeInTheDocument()
    expect(screen.getByText('Referenced by: Work Rule')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open export profiles' })).toHaveAttribute(
      'href',
      '/export?edit=export-1',
    )
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute(
      'href',
      '/rules?edit=rule-1',
    )
  })

  it('reports a failed diagnostic copy instead of claiming success', async () => {
    const error = new ApiError('failed', 500, 'request_failed', 'request-1')
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('permission denied'),
    )
    render(<MemoryRouter><ErrorNotice error={error} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Copy diagnostic' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not copy to the clipboard. Check browser permission and try again.',
    )
    expect(screen.getByRole('button', { name: 'Copy diagnostic' })).toBeInTheDocument()
    writeText.mockRestore()
  })
})
