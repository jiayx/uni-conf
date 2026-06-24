import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { api } from '@/lib/api'
import { getExportSubscriptionFilename } from '@uni-conf/shared'
import type { DashboardStats, ExportFormat } from '@uni-conf/types'
import styles from './Dashboard.module.css'

const STEPS = ['dashboard.step1', 'dashboard.step2', 'dashboard.step3']
const STEP_PATHS = ['/sources', '/sources', '/']
const QUICK_EXPORTS: Array<{ format: ExportFormat; label: string }> = [
  { format: 'mihomo', label: 'Mihomo YAML' },
  { format: 'clash', label: 'Clash / OpenClash YAML' },
  { format: 'singbox', label: 'sing-box JSON' },
  { format: 'loon', label: 'Loon CONF' },
]

export function Dashboard() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [creatingSource, setCreatingSource] = useState(false)

  const loadStats = async () => {
    const nextStats = await api.dashboard.stats()
    setStats(nextStats)
    setError(null)
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadStats()
        .catch(e => setError((e as Error).message))
        .finally(() => setLoading(false))
    })
  }, [])

  const statCards = [
    { label: t('dashboard.sources'), value: stats?.sourceCount ?? 0, icon: <PackageIcon /> },
    { label: t('dashboard.nodes'), value: stats?.nodeCount ?? 0, icon: <NetworkIcon /> },
    { label: t('dashboard.enabled_nodes'), value: stats?.enabledNodeCount ?? 0, icon: <CheckCircleIcon /> },
    { label: t('dashboard.collections'), value: stats?.collectionCount ?? 0, icon: <LayersIcon /> },
    { label: t('dashboard.groups'), value: stats?.groupCount ?? 0, icon: <UsersIcon /> },
    { label: t('dashboard.rules'), value: stats?.ruleCount ?? 0, icon: <ListIcon /> },
    { label: t('dashboard.export_configs'), value: stats?.exportConfigCount ?? 0, icon: <RocketIcon /> },
    {
      label: t('dashboard.last_refreshed'),
      value: stats?.lastRefreshedAt ? new Date(stats.lastRefreshedAt).toLocaleString() : t('dashboard.never'),
      icon: <ClockIcon />,
      wide: true,
    },
  ]

  const isEmpty = !loading && (stats?.sourceCount ?? 0) === 0
  const defaultSubscriptionUrl = stats?.defaultExportToken && stats.defaultExportFormat
    ? `${window.location.origin}/sub/${stats.defaultExportToken}/${getExportSubscriptionFilename(stats.defaultExportFormat)}`
    : ''

  const copyDefaultSubscriptionUrl = () => {
    if (!defaultSubscriptionUrl) return
    void navigator.clipboard.writeText(defaultSubscriptionUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const createSourceFromDashboard = async (event: FormEvent) => {
    event.preventDefault()
    const url = sourceUrl.trim()
    if (!url) {
      setSourceError(t('sources.url_required'))
      return
    }

    setCreatingSource(true)
    setSourceError(null)
    try {
      const result = await api.sources.create({
        type: 'url',
        url,
        format: 'auto',
        enabled: true,
        tags: [],
        updateInterval: 0,
        refreshAfterCreate: true,
      })
      setSourceUrl('')
      if (result.refreshError) {
        setSourceError(t('dashboard.source_refresh_failed', { error: result.refreshError }))
      }
      await loadStats()
    } catch (e) {
      setSourceError((e as Error).message)
    } finally {
      setCreatingSource(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('dashboard.title')} description="UniConf — Manage once, export everywhere." />

      {error && <div className={styles.error}>{error}</div>}
      {sourceError && <div className={styles.inlineError}>{sourceError}</div>}

      {/* Stats */}
      <div className={styles.statsGrid}>
        {statCards.map(stat => (
          <Card key={stat.label} className={`${styles.statCard} ${stat.wide ? styles.wide : ''}`}>
            <div className={styles.statIcon}>{stat.icon}</div>
            <div className={styles.statValue}>{stat.value}</div>
            <div className={styles.statLabel}>{stat.label}</div>
          </Card>
        ))}
      </div>

      {/* Getting Started */}
      {isEmpty && (
        <Card className={styles.gettingStarted}>
          <h2 className={styles.sectionTitle}>{t('dashboard.getting_started')}</h2>
          <p className={styles.sectionDescription}>{t('dashboard.no_data')}</p>
          <form className={styles.sourceForm} onSubmit={createSourceFromDashboard}>
            <Input
              label={t('sources.url')}
              value={sourceUrl}
              onChange={event => setSourceUrl(event.target.value)}
              placeholder={t('sources.url_placeholder')}
            />
            <Button type="submit" loading={creatingSource}>{t('sources.add_url')}</Button>
          </form>
          <div className={styles.steps}>
            {STEPS.map((step, i) => (
              <Link key={step} to={STEP_PATHS[i] ?? '/'} className={styles.step}>
                <div className={styles.stepNumber}>{i + 1}</div>
                <div className={styles.stepText}>
                  <div className={styles.stepLabel}>{t(step)}</div>
                  <div className={styles.stepDescription}>{t(`dashboard.step${i + 1}_desc`)}</div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Quick Export */}
      {!isEmpty && (
        <Card className={styles.quickExport}>
          <h2 className={styles.sectionTitle}>{t('dashboard.quick_export')}</h2>
          {defaultSubscriptionUrl && (
            <div className={styles.subscriptionRow}>
              <code className={styles.subscriptionUrl}>{defaultSubscriptionUrl}</code>
              <Button variant="secondary" size="sm" onClick={copyDefaultSubscriptionUrl}>
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
          )}
          <div className={styles.exportButtons}>
            {QUICK_EXPORTS.map(item => (
              <Button
                key={item.format}
                variant="secondary"
                size="sm"
                onClick={() => window.open(`/api/export/download/${item.format}`, '_blank')}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// Icon components
function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  )
}

function NetworkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  )
}

function RocketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}
