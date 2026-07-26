import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog/ConfirmDialog'
import { Button } from '@/components/ui/Button/Button'
import { Modal, ModalClose } from '@/components/ui/Modal/Modal'
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
  const dirty = open && value !== ''
  useUnsavedChangesGuard(dirty)
  return (
    <Modal
      open={open}
      dirty={dirty}
      onOpenChange={setOpen}
      title="Editor"
      footer={<ModalClose><Button>Cancel edit</Button></ModalClose>}
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

  it('keeps the underlying editor open when its inline discard prompt is cancelled', async () => {
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
    const editor = screen.getByRole('dialog', { name: 'Editor' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(editor).getByRole('alert')).toHaveTextContent('Unsaved changes')
    await user.click(within(editor).getByRole('button', { name: 'Continue editing' }))
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('draft')
  })
})
