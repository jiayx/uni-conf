import type { InputHTMLAttributes, ReactNode } from 'react'
import styles from './Input.module.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  trailingAction?: ReactNode
}

export function Input({ label, error, helperText, trailingAction, id, className = '', ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label} htmlFor={inputId}>{label}</label>}
      <div className={styles.inputShell}>
        <input
          id={inputId}
          className={`${styles.input} ${trailingAction ? styles.hasTrailingAction : ''} ${error ? styles.hasError : ''} ${className}`}
          {...props}
        />
        {trailingAction && <div className={styles.trailingAction}>{trailingAction}</div>}
      </div>
      {error && <span className={styles.error}>{error}</span>}
      {helperText && !error && <span className={styles.helper}>{helperText}</span>}
    </div>
  )
}
