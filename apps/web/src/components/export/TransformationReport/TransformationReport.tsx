import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { compatibilityRemediationAction } from '@/core/export/compatibility-remediation'
import { compatibilityWarningMessage } from '@/core/export/compatibility-warning'
import {
  filterTransformationWarnings,
  summarizeTransformations,
  type TransformationReportFilter,
} from '@/core/export/transformation-report'
import type { CompatibilityTransformation, CompatibilityWarning } from '@uni-conf/types'
import styles from './TransformationReport.module.css'

const FILTERS: TransformationReportFilter[] = ['all', 'changed', 'skipped', 'blocked']

export function TransformationReport({ warnings }: { warnings: CompatibilityWarning[] }) {
  const { t, i18n } = useTranslation()
  const [filter, setFilter] = useState<TransformationReportFilter>('all')
  const summary = useMemo(() => summarizeTransformations(warnings), [warnings])
  const counts: Record<TransformationReportFilter, number> = {
    all: summary.total,
    changed: summary.changed,
    skipped: summary.skipped,
    blocked: summary.blocked,
  }
  const activeFilter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter
  const visibleWarnings = useMemo(
    () => filterTransformationWarnings(warnings, activeFilter),
    [activeFilter, warnings],
  )

  if (summary.total === 0) return null

  return (
    <section className={styles.report} aria-labelledby="transformation-report-title">
      <div className={styles.header}>
        <div>
          <h2 id="transformation-report-title">{t('preview.transformation_title')}</h2>
          <p>{t('preview.transformation_desc')}</p>
        </div>
        <div className={styles.filters} aria-label={t('preview.transformation_filter_label')}>
          {FILTERS.map(item => (
            <button
              key={item}
              type="button"
              className={activeFilter === item ? styles.activeFilter : ''}
              aria-pressed={activeFilter === item}
              disabled={item !== 'all' && counts[item] === 0}
              onClick={() => setFilter(item)}
            >
              {t(`preview.transformation_filter_${item}`, { count: counts[item] })}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.rows}>
        {visibleWarnings.map((warning, index) => {
          const transformation = warning.transformation!
          const action = compatibilityRemediationAction(warning)
          return (
            <article className={styles.row} key={`${warning.code ?? warning.level}-${warning.ruleId ?? index}`}>
              <div className={styles.mapping}>
                <span className={`${styles.badge} ${styles[transformation.action]}`}>
                  {t(`preview.transformation_action_${transformation.action.replace('-', '_')}`)}
                </span>
                <code>{transformation.source}</code>
                <span className={styles.arrow} aria-hidden="true">→</span>
                <code className={!transformation.target ? styles.omitted : ''}>
                  {transformation.target ?? t('preview.transformation_not_exported')}
                </code>
              </div>
              <div className={styles.detail}>
                <span>{compatibilityWarningMessage(warning, i18n.resolvedLanguage)}</span>
                {hasCounts(transformation) && (
                  <span className={styles.counts}>
                    {t('preview.transformation_rule_counts', {
                      converted: transformation.convertedCount ?? 0,
                      skipped: transformation.skippedCount ?? 0,
                    })}
                  </span>
                )}
                {action && <Link to={action.to}>{t(action.labelKey)}</Link>}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function hasCounts(transformation: CompatibilityTransformation): boolean {
  return transformation.convertedCount !== undefined || transformation.skippedCount !== undefined
}
