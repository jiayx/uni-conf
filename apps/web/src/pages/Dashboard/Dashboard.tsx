import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { api } from '@/lib/api'
import type { DashboardStats } from '@uni-conf/types'
import styles from './Dashboard.module.css'

const STEPS = ['dashboard.step1', 'dashboard.step2', 'dashboard.step3', 'dashboard.step4', 'dashboard.step5']
const STEP_PATHS = ['/sources', '/collections', '/groups', '/rules', '/export']

export function Dashboard() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      void api.dashboard.stats()
        .then(nextStats => {
          setStats(nextStats)
          setError(null)
        })
        .catch(e => setError((e as Error).message))
        .finally(() => setLoading(false))
    })
  }, [])

  const statCards = [
    { label: t('dashboard.sources'), value: stats?.sourceCount ?? 0, icon: '📦' },
    { label: t('dashboard.nodes'), value: stats?.nodeCount ?? 0, icon: '🔗' },
    { label: t('dashboard.enabled_nodes'), value: stats?.enabledNodeCount ?? 0, icon: '✅' },
    { label: t('dashboard.collections'), value: stats?.collectionCount ?? 0, icon: '🧩' },
    { label: t('dashboard.groups'), value: stats?.groupCount ?? 0, icon: '🎛' },
    { label: t('dashboard.rules'), value: stats?.ruleCount ?? 0, icon: '📋' },
    { label: t('dashboard.export_configs'), value: stats?.exportConfigCount ?? 0, icon: '🚀' },
    {
      label: t('dashboard.last_refreshed'),
      value: stats?.lastRefreshedAt ? new Date(stats.lastRefreshedAt).toLocaleString() : t('dashboard.never'),
      icon: '🕒',
      wide: true,
    },
  ]

  const isEmpty = !loading && (stats?.sourceCount ?? 0) === 0

  return (
    <div className={styles.page}>
      <PageHeader title={t('dashboard.title')} description="UniConf — Manage once, export everywhere." />

      {error && <div className={styles.error}>{error}</div>}

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
          <div className={styles.steps}>
            {STEPS.map((step, i) => (
              <Link key={step} to={STEP_PATHS[i] ?? '/'} className={styles.step}>
                <div className={styles.stepNumber}>{i + 1}</div>
                <div className={styles.stepLabel}>{t(step)}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Quick Export */}
      {!isEmpty && (
        <Card className={styles.quickExport}>
          <h2 className={styles.sectionTitle}>{t('dashboard.quick_export')}</h2>
          <div className={styles.exportButtons}>
            <Button variant="secondary" size="sm" onClick={() => window.open('/api/export/download/mihomo', '_blank')}>
              Mihomo YAML
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.open('/api/export/download/singbox', '_blank')}>
              sing-box JSON
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.open('/api/export/download/loon', '_blank')}>
              Loon CONF
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
