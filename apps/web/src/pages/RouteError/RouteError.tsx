import { Link, isRouteErrorResponse, useLocation, useRouteError } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button/Button'
import styles from './RouteError.module.css'

export function RouteError() {
  const { t } = useTranslation()
  const error = useRouteError()
  const location = useLocation()
  const status = isRouteErrorResponse(error) ? String(error.status) : t('routeError.status')

  return (
    <main className={styles.page}>
      <section className={styles.panel} role="alert" aria-labelledby="route-error-title">
        <div className={styles.iconWrap}>
          <ErrorIcon />
        </div>
        <div className={styles.status}>{status}</div>
        <h1 className={styles.title} id="route-error-title">{t('routeError.title')}</h1>
        <p className={styles.description}>{t('routeError.description')}</p>
        <code className={styles.path}>{location.pathname}</code>
        <div className={styles.actions}>
          <Button onClick={() => window.location.reload()} icon={<ReloadIcon />}>
            {t('routeError.reload')}
          </Button>
          <Link className={styles.homeLink} to="/">
            {t('routeError.back_home')}
          </Link>
        </div>
      </section>
    </main>
  )
}

function ErrorIcon() {
  return (
    <svg className={styles.errorIcon} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 5 4.8 39a2.7 2.7 0 0 0 2.4 4h33.6a2.7 2.7 0 0 0 2.4-4L24 5Z" />
      <path d="M24 17v11" />
      <circle cx="24" cy="35" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M16 7a7 7 0 1 0 1 5" />
      <path d="M16 3v4h-4" />
    </svg>
  )
}
