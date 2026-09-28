import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button/Button'
import styles from './IconActionButton.module.css'

type Props = Omit<ComponentProps<typeof Button>, 'children' | 'icon' | 'variant' | 'size'> & {
  action: 'edit' | 'delete' | 'copy' | 'copied' | 'refresh' | 'move_up' | 'move_down'
}

export function IconActionButton({ action, className = '', title, 'aria-label': label, ...props }: Props) {
  const { t } = useTranslation()
  const name = label ?? t(`common.${action}`)
  return (
    <Button {...props} variant="ghost" size="sm" aria-label={name} title={title ?? name}
      data-action={action} className={`${styles.button} ${className}`}
      icon={(
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {action === 'delete' ? (
            <path transform="translate(0 -0.5)" d="M4 7h16M9 7V4.75A.75.75 0 0 1 9.75 4h4.5a.75.75 0 0 1 .75.75V7M6 7l.8 12.1a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 7M10 11v6M14 11v6" />
          ) : action === 'move_up' ? (
            <path d="M12 19V5m-7 7 7-7 7 7" />
          ) : action === 'move_down' ? (
            <path d="M12 5v14m7-7-7 7-7-7" />
          ) : action === 'refresh' ? (
            <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.34 5.66" />
          ) : action === 'copied' ? (
            <path d="m5 12 4 4L19 6" />
          ) : action === 'copy' ? (
            <>
              <rect x="8" y="8" width="12" height="13" rx="2" />
              <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            </>
          ) : (
            <path transform="translate(0 1)" d="m15 5 4 4M4 20l4.5-1 12-12a2.83 2.83 0 0 0-4-4l-12 12L4 20Z" />
          )}
        </svg>
      )}
    />
  )
}
