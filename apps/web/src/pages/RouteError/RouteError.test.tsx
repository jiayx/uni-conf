import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import i18n from '@/i18n'
import { RouteError } from './RouteError'

describe('RouteError', () => {
  it('replaces runtime details with recovery actions', async () => {
    await i18n.changeLanguage('en')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{
      path: '/broken',
      element: <BrokenPage />,
      errorElement: <RouteError />,
    }], { initialEntries: ['/broken'] })

    render(<RouterProvider router={router} />)

    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be displayed')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByText('/broken')).toBeInTheDocument()
    expect(screen.queryByText('private diagnostic detail')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
})

function BrokenPage(): never {
  throw new Error('private diagnostic detail')
}
