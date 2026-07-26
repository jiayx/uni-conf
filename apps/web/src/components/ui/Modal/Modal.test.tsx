import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { Button } from '../Button/Button'
import { Modal, ModalClose } from './Modal'

function DirtyModalHarness() {
  const [open, setOpen] = useState(true)
  return (
    <Modal
      open={open}
      dirty
      onOpenChange={setOpen}
      title="Editor"
      footer={<ModalClose><Button variant="secondary">Cancel edit</Button></ModalClose>}
    >
      <label>
        Draft
        <input defaultValue="draft" />
      </label>
    </Modal>
  )
}

describe('Modal dirty close confirmation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('confirms inside the current modal without adding another overlay dialog', async () => {
    const user = userEvent.setup()
    render(<DirtyModalHarness />)

    const editor = screen.getByRole('dialog', { name: 'Editor' })
    await user.click(within(editor).getByRole('button', { name: 'Close' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(editor).getByRole('alert')).toHaveTextContent('Unsaved changes')
    expect(within(editor).getByRole('button', { name: 'Continue editing' })).toHaveFocus()

    await user.click(within(editor).getByRole('button', { name: 'Continue editing' }))
    expect(within(editor).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(editor).getByRole('textbox', { name: 'Draft' })).toHaveValue('draft')

    await user.keyboard('{Escape}')
    expect(within(editor).getByRole('alert')).toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('dialog', { name: 'Editor' })).not.toBeInTheDocument()
  })
})
