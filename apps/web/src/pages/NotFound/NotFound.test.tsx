import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import i18n from '@/i18n'
import { NotFound } from './NotFound'

describe('NotFound', () => {
  it('shows the missing path and a link back to the dashboard', async () => {
    await i18n.changeLanguage('en')
    render(
      <MemoryRouter initialEntries={['/missing-page']}>
        <NotFound />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('/missing-page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/')
  })
})
