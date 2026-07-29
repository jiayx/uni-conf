import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import styles from './NotFound.module.css'

export function NotFound() {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <section className={styles.page}>
      <div className={styles.content}>
        <RouteIcon />
        <div className={styles.status}>404</div>
        <h1 className={styles.title}>{t('notFound.title')}</h1>
        <p className={styles.description}>{t('notFound.description')}</p>
        <code className={styles.path}>{location.pathname}</code>
        <Link className={styles.homeLink} to="/">
          <HomeIcon />
          <span>{t('notFound.back_home')}</span>
        </Link>
      </div>
    </section>
  )
}

function RouteIcon() {
  return (
    <svg
      className={styles.routeIcon}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="12" r="4" />
      <circle cx="37" cy="36" r="4" />
      <path d="M15 12h8a5 5 0 0 1 5 5v3a5 5 0 0 0 5 5h4" />
      <path d="M22 30l6 6m0-6-6 6" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m3 9 7-6 7 6v8H6V9" />
      <path d="M8 17v-5h4v5" />
    </svg>
  )
}
