import { useEffect } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { useSourcesStore } from '@/store/sources.store'
import { useNodesStore } from '@/store/nodes.store'
import { useRulesStore } from '@/store/rules.store'
import styles from './Dashboard.module.css'

const STEPS = ['dashboard.step1', 'dashboard.step2', 'dashboard.step3', 'dashboard.step4', 'dashboard.step5']
const STEP_PATHS = ['/sources', '/collections', '/groups', '/rules', '/export']

export function Dashboard() {
  const { t } = useTranslation()
  const { sources, fetchSources } = useSourcesStore()
  const { nodes, fetchNodes } = useNodesStore()
  const { rules, fetchRules } = useRulesStore()

  useEffect(() => {
    void fetchSources()
    void fetchNodes()
    void fetchRules()
  }, [fetchSources, fetchNodes, fetchRules])

  const stats = [
    { label: t('dashboard.sources'), value: sources.length, icon: '📦', color: 'purple' },
    { label: t('dashboard.nodes'), value: nodes.length, icon: '🔗', color: 'blue' },
    { label: t('dashboard.enabled_nodes'), value: nodes.filter(n => n.enabled).length, icon: '✅', color: 'green' },
    { label: t('dashboard.rules'), value: rules.length, icon: '📋', color: 'orange' },
  ]

  const isEmpty = sources.length === 0

  return (
    <div className={styles.page}>
      <PageHeader title={t('dashboard.title')} description="UniConf — Manage once, export everywhere." />

      {/* Stats */}
      <div className={styles.statsGrid}>
        {stats.map(stat => (
          <Card key={stat.label} className={styles.statCard}>
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
