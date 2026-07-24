import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { useRequestedEdit } from './use-requested-edit'

const item = { id: 'item/1', name: 'Target' }

function Harness({
  delayed = false,
  consumeParams,
  onEdit,
}: {
  delayed?: boolean
  consumeParams?: readonly string[]
  onEdit: (value: typeof item, params: URLSearchParams) => void
}) {
  const [items, setItems] = useState(delayed ? [] : [item])
  const location = useLocation()
  useRequestedEdit(items, onEdit, consumeParams)
  return (
    <>
      <span>{location.search || 'no-query'}</span>
      {delayed && <button onClick={() => setItems([item])}>Load</button>}
    </>
  )
}

describe('useRequestedEdit', () => {
  it('opens the exact requested entity and consumes the query parameter', async () => {
    const onEdit = vi.fn()
    render(
      <MemoryRouter initialEntries={['/nodes?edit=item%2F1']}>
        <Harness onEdit={onEdit} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('no-query')).toBeInTheDocument()
    expect(onEdit).toHaveBeenCalledWith(item, expect.any(URLSearchParams))
  })

  it('waits for asynchronously loaded entities before opening the editor', async () => {
    const onEdit = vi.fn()
    render(
      <MemoryRouter initialEntries={['/rules?edit=item%2F1']}>
        <Harness delayed onEdit={onEdit} />
      </MemoryRouter>,
    )

    expect(onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    expect(await screen.findByText('no-query')).toBeInTheDocument()
    expect(onEdit).toHaveBeenCalledWith(item, expect.any(URLSearchParams))
  })

  it('passes and consumes requested editor context without removing unrelated filters', async () => {
    const onEdit = vi.fn()
    render(
      <MemoryRouter initialEntries={['/remote-rule-sets?edit=item%2F1&nativeSource=singbox&attention=1']}>
        <Harness consumeParams={['nativeSource']} onEdit={onEdit} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('?attention=1')).toBeInTheDocument()
    expect(onEdit).toHaveBeenCalledOnce()
    const requestParams = onEdit.mock.calls[0]?.[1] as URLSearchParams
    expect(requestParams.get('nativeSource')).toBe('singbox')
    expect(requestParams.get('attention')).toBe('1')
  })
})
