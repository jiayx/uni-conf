import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog/ConfirmDialog'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'
import i18n from '@/i18n'
import { useUnsavedChangesGuard } from './use-unsaved-changes'
import { UnsavedChangesProvider } from './UnsavedChangesProvider'

function Editor() {
  const [value, setValue] = useState('')
  useUnsavedChangesGuard(value !== '')
  return (
    <>
      <label>
        Name
        <input value={value} onChange={event => setValue(event.target.value)} />
      </label>
      <Link to="/next">Next page</Link>
    </>
  )
}

function ModalEditor() {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('draft')
  const confirmDiscard = useUnsavedChangesGuard(open && value !== '')
  const requestClose = async () => {
    if (await confirmDiscard()) setOpen(false)
  }
  return (
    <Modal
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) void requestClose()
      }}
      title="Editor"
      footer={<Button onClick={() => void requestClose()}>Cancel edit</Button>}
    >
      <label>
        Draft
        <input value={value} onChange={event => setValue(event.target.value)} />
      </label>
    </Modal>
  )
}

function renderGuardedRouter() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ConfirmDialogProvider>
          <UnsavedChangesProvider>
            <Editor />
          </UnsavedChangesProvider>
        </ConfirmDialogProvider>
      ),
    },
    { path: '/next', element: <h1>Destination</h1> },
  ])
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('UnsavedChangesProvider', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('blocks in-app navigation until the user explicitly discards changes', async () => {
    const user = userEvent.setup()
    renderGuardedRouter()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'draft')
    await user.click(screen.getByRole('link', { name: 'Next page' }))

    const confirmation = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(screen.queryByRole('heading', { name: 'Destination' })).not.toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('draft')

    await user.click(screen.getByRole('link', { name: 'Next page' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' }))
      .getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByRole('heading', { name: 'Destination' })).toBeInTheDocument()
  })

  it('registers native page-unload protection only while dirty', async () => {
    const user = userEvent.setup()
    renderGuardedRouter()

    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'draft')
    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
  })

  it('keeps the underlying editor open when its discard dialog is cancelled', async () => {
    const router = createMemoryRouter([{
      path: '/',
      element: (
        <ConfirmDialogProvider>
          <UnsavedChangesProvider>
            <ModalEditor />
          </UnsavedChangesProvider>
        </ConfirmDialogProvider>
      ),
    }])
    const user = userEvent.setup()
    render(<RouterProvider router={router} />)

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('draft')
  })
})
