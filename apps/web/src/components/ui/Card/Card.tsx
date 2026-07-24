import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  children: ReactNode
  id?: string
  className?: string
  hover?: boolean
  onClick?: () => void
}

export function Card({ children, id, className = '', hover = false, onClick }: CardProps) {
  return (
    <div
      className={`${styles.card} ${hover ? styles.hover : ''} ${onClick ? styles.clickable : ''} ${className}`}
      id={id}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  )
}
