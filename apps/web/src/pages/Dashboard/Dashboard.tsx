import { QRCodeSVG } from 'qrcode.react'
import { Modal } from '@/components/ui/Modal/Modal'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { buildUniversalSubscriptionUrl } from '@/core/export/quick-subscriptions'
import { writeClipboardText } from '@/core/clipboard/write-text'
import {
  deriveDashboardAttention,
  type DashboardAttentionItem,
} from '@/core/dashboard/attention-center'
import {
  DASHBOARD_DATA_CHANGED_EVENT,
  openSetupGuide,
  SETUP_GUIDE_DISMISSED_KEY,
} from '@/core/onboarding/setup-guide'
import { api } from '@/lib/api'
import type { DashboardStats, ExportFormat } from '@uni-conf/types'
import styles from './Dashboard.module.css'

export function Dashboard() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const loadStats = async () => {
    const nextStats = await api.dashboard.stats()
    setStats(nextStats)
    if (
      nextStats.sourceCount === 0
      && nextStats.nodeCount === 0
      && window.sessionStorage.getItem(SETUP_GUIDE_DISMISSED_KEY) !== '1'
    ) {
      openSetupGuide()
    }
    setError(null)
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadStats()
        .catch(e => setError((e as Error).message))
        .finally(() => setLoading(false))
    })
  }, [])

  useEffect(() => {
    const reloadDashboard = () => {
      void loadStats().catch(cause => setError((cause as Error).message))
    }
    window.addEventListener(DASHBOARD_DATA_CHANGED_EVENT, reloadDashboard)
    return () => window.removeEventListener(DASHBOARD_DATA_CHANGED_EVENT, reloadDashboard)
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

  const hasUsableNodes = (stats?.enabledNodeCount ?? 0) > 0
  const needsFirstSetup = !loading && stats?.sourceCount === 0 && stats.nodeCount === 0
  const subscriptionUrl = stats?.defaultExportToken && stats.defaultExportEnabled !== false
    ? buildUniversalSubscriptionUrl(window.location.origin, stats.defaultExportToken)
    : null
  const attentionItems = stats
    ? deriveDashboardAttention(stats)
    : []

  const copySubscriptionUrl = async () => {
    if (!subscriptionUrl) return
    setCopyError(null)
    try {
      await writeClipboardText(subscriptionUrl)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(t('common.clipboard_copy_failed'))
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={needsFirstSetup
          ? <Button onClick={openSetupGuide}>{t('dashboard.setup_submit')}</Button>
          : undefined}
      />

      {error && <div className={styles.error}>{error}</div>}
      {copyError && <div className={styles.inlineError} role="alert">{copyError}</div>}

      {hasUsableNodes && (
        <Card className={styles.quickExport}>
          <div>
            <h2 className={styles.sectionTitle}>{t('dashboard.quick_export')}</h2>
            <p className={styles.sectionDescription}>{t(stats?.defaultExportEnabled === false
              ? 'dashboard.quick_export_paused' : 'dashboard.quick_export_desc')}</p>
          </div>
          <div className={styles.quickActions}>
            {stats?.defaultExportEnabled !== false && (
              <>
                <Button disabled={!subscriptionUrl} onClick={() => void copySubscriptionUrl()}>
                  {t(copied ? 'common.copied' : 'dashboard.copy_subscription')}
                </Button>
                <Button variant="secondary" disabled={!subscriptionUrl} onClick={() => setShowQr(true)}>
                  {t('dashboard.subscription_qr')}
                </Button>
              </>
            )}
            <Link className={styles.manageLink} to="/export">{t('dashboard.more_export_options')}</Link>
          </div>
        </Card>
      )}

      <Modal open={showQr && Boolean(subscriptionUrl)} onOpenChange={setShowQr}
        title={t('export.qr_title', { name: stats?.defaultExportName || 'UniConf' })}
        description={t('export.qr_security_hint')} size="sm">
        {subscriptionUrl && <div className={styles.qrCode}>
          <QRCodeSVG value={subscriptionUrl} size={240} level="M" marginSize={2} title={t('export.qr_image_label')} />
        </div>}
      </Modal>

      {attentionItems.length > 0 && (
        <AttentionCenter items={attentionItems} format={stats?.defaultExportFormat ?? 'mihomo'} />
      )}

      {loading ? (
        <Card className={styles.statsLoading} role="status" aria-live="polite">
          <span className={styles.loadingIndicator} aria-hidden="true" />
          {t('common.loading')}
        </Card>
      ) : stats ? (
        <div className={styles.statsGrid}>
          {statCards.map(stat => (
            <Card key={stat.label} className={`${styles.statCard} ${stat.wide ? styles.wide : ''}`}>
              <div className={styles.statIcon}>{stat.icon}</div>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </Card>
          ))}
        </div>
      ) : null}

    </div>
  )
}

function AttentionCenter({
  items,
  format,
}: {
  items: DashboardAttentionItem[]
  format: ExportFormat
}) {
  const { t } = useTranslation()
  const totalCount = items.reduce((sum, item) => sum + item.count, 0)
  const hasBlockingItem = items.some(item => item.severity === 'error')

  return (
    <Card className={styles.attentionCenter}>
      <div className={styles.attentionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>{t('dashboard.attention_title')}</h2>
          <p className={styles.attentionDescription}>
            {t('dashboard.attention_summary', {
              count: totalCount,
              categoryCount: items.length,
            })}
          </p>
        </div>
        <Badge variant={hasBlockingItem ? 'error' : 'warning'}>
          {t(hasBlockingItem ? 'dashboard.attention_has_blockers' : 'dashboard.attention_review')}
        </Badge>
      </div>
      <ul className={styles.attentionList}>
        {items.map(item => (
          <li className={`${styles.attentionItem} ${styles[`attentionItem_${item.severity}`]}`} key={item.id}>
            <span className={styles.attentionDot} aria-hidden="true" />
            <div className={styles.attentionContent}>
              <strong>{t(`dashboard.attention_${item.id}_title`, { count: item.count })}</strong>
              <span>{t(`dashboard.attention_${item.id}_description`, {
                count: item.count,
                format: t(`export.formats.${format}`),
              })}</span>
            </div>
            <Link to={item.to}>{t('dashboard.attention_open')}</Link>
          </li>
        ))}
      </ul>
    </Card>
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
