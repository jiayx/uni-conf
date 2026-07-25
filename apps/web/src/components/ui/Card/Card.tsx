import type { HTMLAttributes, KeyboardEvent } from 'react'
import styles from './Card.module.css'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
}

export function Card({
  children,
  className = '',
  hover = false,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...props
}: CardProps) {
  const interactive = Boolean(onClick)
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !onClick || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    event.currentTarget.click()
  }

  return (
    <div
      className={`${styles.card} ${hover ? styles.hover : ''} ${interactive ? styles.clickable : ''} ${className}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={role ?? (interactive ? 'button' : undefined)}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      {...props}
    >
      {children}
    </div>
  )
}
