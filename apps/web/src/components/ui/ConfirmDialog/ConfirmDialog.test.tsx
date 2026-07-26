import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import i18n from '@/i18n'
import { ConfirmDialogProvider } from './ConfirmDialog'
import { useConfirmDialog } from './useConfirmDialog'
import modalStyles from '../Modal/Modal.module.css'

function Harness() {
  const confirm = useConfirmDialog()
  const [result, setResult] = useState('pending')
  return (
    <>
      <button onClick={() => void confirm({
        title: 'Delete item',
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }).then(value => setResult(String(value)))}>Open</button>
      <span>{result}</span>
    </>
  )
}

describe('ConfirmDialog', () => {
  it('resolves true only after explicit confirmation', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete item' })
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
    expect(dialog).toHaveClass(modalStyles.noBody)
    expect(dialog.querySelector(`.${modalStyles.body}`)).not.toBeInTheDocument()
    expect(dialog).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(modalStyles.closeButton)
    expect(screen.getByText('pending')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('true')).toBeInTheDocument()
  })

  it('treats cancellation as false', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('false')).toBeInTheDocument()
  })

  it('localizes the shared close control', async () => {
    await i18n.changeLanguage('zh')
    const user = userEvent.setup()
    render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))

    expect(await screen.findByText('false')).toBeInTheDocument()
  })

  it('settles a pending request as cancelled when its provider unmounts', async () => {
    await i18n.changeLanguage('en')
    const onResolved = vi.fn()

    function PendingHarness() {
      const confirm = useConfirmDialog()
      return <button onClick={() => void confirm({ description: 'Pending action' }).then(onResolved)}>Open pending</button>
    }

    const user = userEvent.setup()
    const { unmount } = render(<ConfirmDialogProvider><PendingHarness /></ConfirmDialogProvider>)
    await user.click(screen.getByRole('button', { name: 'Open pending' }))
    unmount()

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(false))
  })
})
