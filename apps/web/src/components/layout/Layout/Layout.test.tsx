import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { Layout } from './Layout'

describe('application layout navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api.workspaces, 'list').mockResolvedValue([{
      id: 'default',
      name: 'Default',
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }])
    void i18n.changeLanguage('en')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
  })

  it('renders the outlet and every primary navigation destination', async () => {
    setViewportWidth(1280)
    renderLayout()

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Configuration space' }).children.length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dashboard', 'Sources', 'Nodes', 'Node Groups', 'Routing Plan',
      'Manual Rules', 'Rule Set Management', 'Export', 'Settings',
    ])
  })

  it('opens the mobile sidebar and closes it after navigation', async () => {
    const user = userEvent.setup()
    renderLayout()
    const toggle = screen.getByRole('button', { name: 'Open primary navigation' })
    const sidebar = document.getElementById('primary-navigation')!

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(sidebar).toHaveAttribute('aria-hidden', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Close primary navigation')
    expect(sidebar.className).toMatch(/open/)
    expect(sidebar).not.toHaveAttribute('aria-hidden')
    expect(sidebar).toHaveAttribute('aria-modal', 'true')
    const close = within(sidebar).getByRole('button', { name: 'Close primary navigation' })
    await waitFor(() => expect(close).toHaveFocus())

    await user.click(screen.getByRole('link', { name: 'Sources' }))
    expect(await screen.findByText('Sources page')).toBeInTheDocument()
    expect(sidebar.className).not.toMatch(/open/)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('closes the mobile sidebar when the overlay is clicked', async () => {
    const user = userEvent.setup()
    const { container } = renderLayout()
    const toggle = screen.getByRole('button', { name: 'Open primary navigation' })

    await user.click(toggle)
    await user.click(container.querySelector('div[aria-hidden="true"]')!)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('traps focus in the mobile drawer and closes it with Escape', async () => {
    const user = userEvent.setup()
    renderLayout()
    const toggle = screen.getByRole('button', { name: 'Open primary navigation' })

    await user.click(toggle)
    const sidebar = screen.getByRole('dialog', { name: 'Primary navigation' })
    const close = within(sidebar).getByRole('button', { name: 'Close primary navigation' })
    const manageWorkspaces = within(sidebar).getByRole('button', { name: 'Manage configuration spaces' })
    await waitFor(() => expect(close).toHaveFocus())
    manageWorkspaces.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('closes the mobile sidebar from its visible close button', async () => {
    const user = userEvent.setup()
    renderLayout()
    const toggle = screen.getByRole('button', { name: 'Open primary navigation' })

    await user.click(toggle)
    const sidebar = screen.getByRole('dialog', { name: 'Primary navigation' })
    await user.click(within(sidebar).getByRole('button', { name: 'Close primary navigation' }))

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(toggle).toHaveFocus())
  })
})

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function renderLayout() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <div>Dashboard page</div> },
        { path: 'sources', element: <div>Sources page</div> },
      ],
    },
  ])
  return render(<RouterProvider router={router} />)
}
