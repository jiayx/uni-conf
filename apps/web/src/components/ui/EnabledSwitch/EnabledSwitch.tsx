import type { ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './EnabledSwitch.module.css'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'role' | 'aria-checked'> & {
  checked: boolean
  loading?: boolean
}

export function EnabledSwitch({ checked, loading = false, disabled, className = '', ...props }: Props) {
  const { t } = useTranslation()
  return (
    <button {...props} type="button" role="switch" aria-checked={checked} aria-busy={loading || undefined}
      disabled={disabled || loading} className={`${styles.control} ${className}`}>
      <span className={styles.track} aria-hidden="true"><span className={styles.thumb} /></span>
      <span>{t(checked ? 'common.enabled' : 'common.disabled')}</span>
    </button>
  )
}
