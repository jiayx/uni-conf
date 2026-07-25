import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('forwards semantic attributes', () => {
    render(<Card role="status" aria-live="polite">Loading</Card>)

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it.each(['Enter', ' '])('supports %s keyboard activation when interactive', key => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>Open</Card>)

    const card = screen.getByRole('button', { name: 'Open' })
    expect(card).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(card, { key })

    expect(onClick).toHaveBeenCalledOnce()
  })
})
