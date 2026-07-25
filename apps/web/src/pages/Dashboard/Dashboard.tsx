import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { summarizeDashboardSourceCreateResults } from '@/core/sources/dashboard-source-create'
import { parseSubscriptionUrls } from '@/core/sources/subscription-urls'
import { QUICK_EXPORT_OPTIONS } from '@/core/export/formats'
import { saveExportDownload } from '@/core/export/download-file'
import { buildQuickSubscriptionLinks } from '@/core/export/quick-subscriptions'
import { deriveExportReadiness, type ExportReadiness } from '@/core/export/readiness'
import { compatibilityRemediationAction } from '@/core/export/compatibility-remediation'
import { writeClipboardText } from '@/core/clipboard/write-text'
import {
  deriveDashboardJourney,
  type DashboardJourneyReadiness,
  type DashboardJourneyStage,
} from '@/core/dashboard/configuration-journey'
import {
  deriveDashboardAttention,
  type DashboardAttentionItem,
} from '@/core/dashboard/attention-center'
import { api } from '@/lib/api'
import { useSettingsStore } from '@/store/settings.store'
import { ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared'
import type { CompatibilityWarning, DashboardStats, ExportArtifactValidationIssue, ExportFormat, RoutingPolicyTemplateId } from '@uni-conf/types'
import styles from './Dashboard.module.css'

type QuickReadinessState =
  | { status: 'idle' }
  | { status: 'loading'; format: ExportFormat }
  | { status: 'ready'; format: ExportFormat; readiness: ExportReadiness; warnings: CompatibilityWarning[]; blockingWarnings: CompatibilityWarning[]; issue?: ExportArtifactValidationIssue }
  | { status: 'error'; format: ExportFormat }

export function Dashboard() {
  const { t } = useTranslation()
  const applySettings = useSettingsStore(state => state.applySettings)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [creatingSource, setCreatingSource] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null)
  const [selectedQuickFormat, setSelectedQuickFormat] = useState<typeof QUICK_EXPORT_OPTIONS[number]['value']>('mihomo')
  const [quickReadiness, setQuickReadiness] = useState<QuickReadinessState>({ status: 'idle' })
  const [readinessVersion, setReadinessVersion] = useState(0)
  const [activeTemplate, setActiveTemplate] = useState<RoutingPolicyTemplateId>('common')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)

  const loadStats = async () => {
    const nextStats = await api.dashboard.stats()
    setStats(nextStats)
    const defaultFormat = nextStats.defaultExportFormat
    if (defaultFormat && QUICK_EXPORT_OPTIONS.some(option => option.value === defaultFormat)) {
      setSelectedQuickFormat(defaultFormat)
    }
    setReadinessVersion(version => version + 1)
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
    queueMicrotask(() => {
      void api.settings.get()
        .then(settings => {
          applySettings(settings)
          setActiveTemplate(settings.routingPolicyTemplate)
          setAutoRefreshEnabled(settings.enableAutoRefresh)
        })
        .catch(e => setError((e as Error).message))
    })
  }, [applySettings])

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
  const needsSetup = !loading && !hasUsableNodes
  const canCreateSource = parseSubscriptionUrls(sourceUrl).length > 0
  const quickSubscriptionLinks = buildQuickSubscriptionLinks(
    window.location.origin,
    stats?.defaultExportToken,
    stats?.defaultExportEnabled !== false,
  )
  const selectedQuickLink = quickSubscriptionLinks.find(item => item.value === selectedQuickFormat)
  const selectedReadiness = quickReadiness.status !== 'idle' && quickReadiness.format === selectedQuickFormat
    ? quickReadiness
    : { status: 'loading' as const, format: selectedQuickFormat }
  const exportBlocked = selectedReadiness.status === 'ready' && selectedReadiness.readiness.status === 'blocked'
  const exportChecking = selectedReadiness.status === 'loading'
  const journeyWarning = selectedReadiness.status === 'ready'
    ? selectedReadiness.blockingWarnings[0] ?? selectedReadiness.warnings[0]
    : undefined
  const journeyRemediation = journeyWarning
    ? compatibilityRemediationAction(journeyWarning)
    : null
  const journeyReadiness: DashboardJourneyReadiness = selectedReadiness.status === 'ready'
    ? selectedReadiness.readiness.status
    : selectedReadiness.status === 'error'
      ? 'unknown'
      : 'checking'
  const journey = stats
    ? deriveDashboardJourney(
        stats,
        journeyReadiness,
        journeyRemediation?.to,
        `/preview?format=${selectedQuickFormat}`,
      )
    : []
  const attentionItems = stats
    ? deriveDashboardAttention(stats, {
        status: selectedReadiness.status === 'ready'
          ? selectedReadiness.readiness.status
          : selectedReadiness.status === 'error'
            ? 'unknown'
            : 'checking',
        issueCount: selectedReadiness.status === 'ready'
          ? selectedReadiness.blockingWarnings.length
            || selectedReadiness.warnings.length
            || (selectedReadiness.issue ? 1 : 0)
          : undefined,
        remediationTo: journeyRemediation?.to,
        previewTo: `/preview?format=${selectedQuickFormat}`,
      })
    : []

  useEffect(() => {
    if (!hasUsableNodes || stats?.defaultExportEnabled === false) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setQuickReadiness({ status: 'loading', format: selectedQuickFormat })
      void api.export.readinessFormat(selectedQuickFormat)
        .then(result => {
          if (cancelled) return
          setQuickReadiness({
            status: 'ready',
            format: selectedQuickFormat,
            readiness: deriveExportReadiness(result),
            warnings: result.warnings ?? [],
            blockingWarnings: result.readiness.blockingWarnings,
            issue: result.artifactValidation.issues[0],
          })
        })
        .catch(() => {
          if (!cancelled) setQuickReadiness({ status: 'error', format: selectedQuickFormat })
        })
    })
    return () => { cancelled = true }
  }, [hasUsableNodes, readinessVersion, selectedQuickFormat, stats?.defaultExportEnabled])

  const copySubscriptionUrl = async (format: string, url: string) => {
    setDownloadError(null)
    try {
      await writeClipboardText(url)
      setCopiedFormat(format)
      window.setTimeout(() => setCopiedFormat(null), 2000)
    } catch {
      setDownloadError(t('common.clipboard_copy_failed'))
    }
  }

  const createSourceFromDashboard = async (event: FormEvent) => {
    event.preventDefault()
    const urls = parseSubscriptionUrls(sourceUrl)
    if (urls.length === 0) {
      setSourceError(t('sources.url_required'))
      return
    }

    setCreatingSource(true)
    setSourceError(null)
    try {
      const results = await Promise.allSettled(
        urls.map(url => api.sources.create({
          url,
        }))
      )
      const summary = summarizeDashboardSourceCreateResults(urls, results)

      setSourceUrl(summary.nextInput)
      if (summary.error?.kind === 'save-failed') {
        setSourceError(t('sources.save_failed_count', { count: summary.error.count ?? 0, message: summary.error.message }))
      } else if (summary.error?.kind === 'refresh-failed') {
        setSourceError(t('dashboard.source_refresh_failed', { error: summary.error.message }))
      }
      await loadStats()
    } catch (e) {
      setSourceError((e as Error).message)
    } finally {
      setCreatingSource(false)
    }
  }

  const selectTemplate = async (templateId: RoutingPolicyTemplateId) => {
    const template = ROUTING_POLICY_TEMPLATES.find(item => item.id === templateId)
    setSavingTemplate(true)
    setError(null)
    try {
      const updated = await api.settings.update({
        routingPolicyTemplate: templateId,
        dnsMode: template?.recommendedDnsMode,
      })
      applySettings(updated)
      setActiveTemplate(updated.routingPolicyTemplate)
      await loadStats()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSavingTemplate(false)
    }
  }

  const downloadQuickExport = async (format: typeof QUICK_EXPORT_OPTIONS[number]['value']) => {
    setDownloadingFormat(format)
    setDownloadError(null)
    try {
      saveExportDownload(await api.export.downloadFormat(format))
    } catch (e) {
      setDownloadError((e as Error).message)
    } finally {
      setDownloadingFormat(null)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />

      {error && <div className={styles.error}>{error}</div>}
      {sourceError && <div id="dashboard-source-error" className={styles.inlineError} role="alert">{sourceError}</div>}
      {downloadError && <div className={styles.inlineError} role="alert">{downloadError}</div>}

      {stats && <ConfigurationJourney stages={journey} />}
      {attentionItems.length > 0 && (
        <AttentionCenter items={attentionItems} format={selectedQuickFormat} />
      )}

      {/* Stats */}
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

      {stats?.ruleSetHealth && stats.ruleSetHealth.total > 0 && (
        <Card className={styles.ruleSetHealth}>
          <div className={styles.ruleSetHealthHeader}>
            <div>
              <h2 className={styles.sectionTitle}>{t('dashboard.rule_set_health_title')}</h2>
              <p className={styles.ruleSetHealthDescription}>
                {t(autoRefreshEnabled
                  ? 'dashboard.rule_set_health_auto_on'
                  : 'dashboard.rule_set_health_auto_off')}
              </p>
            </div>
            <Link to="/remote-rule-sets">{t('dashboard.rule_set_health_manage')}</Link>
          </div>
          <div className={styles.ruleSetHealthBadges}>
            <Badge variant="success">{t('dashboard.rule_set_health_valid', { count: stats.ruleSetHealth.valid })}</Badge>
            <Badge variant="warning">{t('dashboard.rule_set_health_warning', { count: stats.ruleSetHealth.warning })}</Badge>
            <Badge variant="error">{t('dashboard.rule_set_health_invalid', { count: stats.ruleSetHealth.invalid })}</Badge>
            <Badge variant="warning">{t('dashboard.rule_set_health_stale', { count: stats.ruleSetHealth.stale })}</Badge>
            <Badge variant="default">{t('dashboard.rule_set_health_pending', { count: stats.ruleSetHealth.pending })}</Badge>
          </div>
          <div className={styles.ruleSetHealthMeta}>
            {stats.ruleSetHealth.lastCheckedAt
              ? t('dashboard.rule_set_health_last_checked', { time: new Date(stats.ruleSetHealth.lastCheckedAt).toLocaleString() })
              : t('dashboard.rule_set_health_never_checked')}
          </div>
        </Card>
      )}

      {/* Getting Started */}
      {needsSetup && (
        <Card className={styles.gettingStarted}>
          <h2 className={styles.sectionTitle}>{t('dashboard.getting_started')}</h2>
          <p className={styles.sectionDescription}>{t(
            (stats?.sourceCount ?? 0) > 0 ? 'dashboard.no_usable_nodes' : 'dashboard.no_data'
          )}</p>
          <div className={styles.templatePicker}>
            <div className={styles.templateHeader}>
              <div className={styles.templateTitle}>{t('dashboard.template_title')}</div>
              <div className={styles.templateDesc}>{t('dashboard.template_desc')}</div>
            </div>
            <div className={styles.templateOptions}>
              {ROUTING_POLICY_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className={`${styles.templateOption} ${activeTemplate === template.id ? styles.templateOptionActive : ''}`}
                  onClick={() => void selectTemplate(template.id)}
                  disabled={savingTemplate}
                >
                  <span>{template.name}</span>
                  <small>{template.description}</small>
                </button>
              ))}
            </div>
          </div>
          <form className={styles.sourceForm} onSubmit={event => void createSourceFromDashboard(event)}>
            <label className={styles.sourceInput}>
              <span>{t('sources.url')}</span>
              <textarea
                className={styles.textarea}
                value={sourceUrl}
                onChange={event => setSourceUrl(event.target.value)}
                placeholder={t('sources.url_placeholder')}
                required
                aria-invalid={Boolean(sourceError)}
                aria-describedby={sourceError ? 'dashboard-source-error' : undefined}
              />
            </label>
            <Button type="submit" loading={creatingSource} disabled={!canCreateSource}>{t('sources.add_url')}</Button>
          </form>
        </Card>
      )}

      {/* Quick Export */}
      {hasUsableNodes && (
        <Card className={styles.quickExport}>
          <h2 className={styles.sectionTitle}>{t('dashboard.quick_export')}</h2>
          <p className={styles.sectionDescription}>{t('dashboard.quick_export_desc')}</p>
          {stats?.defaultExportEnabled === false ? (
            <div className={styles.pausedExport}>
              <span>{t('dashboard.quick_export_paused')}</span>
              <Link to="/export">{t('dashboard.manage_export_links')}</Link>
            </div>
          ) : <>
            <ExportReadinessPanel state={selectedReadiness} format={selectedQuickFormat} />
            <div className={styles.quickExportControl}>
              <label className={styles.quickFormatField}>
                <span>{t('export.format')}</span>
                <select
                  value={selectedQuickFormat}
                  onChange={event => setSelectedQuickFormat(event.target.value as typeof selectedQuickFormat)}
                >
                  {QUICK_EXPORT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{t(`export.formats.${option.value}`)}</option>
                  ))}
                </select>
              </label>
              <div className={styles.quickLinkActions}>
                <Button
                  variant="secondary"
                  disabled={!selectedQuickLink || exportChecking || exportBlocked}
                  onClick={() => {
                    if (selectedQuickLink) void copySubscriptionUrl(selectedQuickLink.value, selectedQuickLink.url)
                  }}
                >
                  {copiedFormat === selectedQuickFormat ? t('common.copied') : t('export.copy_url')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={exportChecking || exportBlocked}
                  loading={downloadingFormat === selectedQuickFormat}
                  onClick={() => void downloadQuickExport(selectedQuickFormat)}
                >
                  {t('common.download')}
                </Button>
                <Link className={styles.manageLink} to="/export">{t('dashboard.manage_export_links')}</Link>
              </div>
              <p className={styles.sensitiveHint}>{t('dashboard.quick_export_sensitive_hint')}</p>
            </div>
          </>}
        </Card>
      )}
    </div>
  )
}

function ConfigurationJourney({ stages }: { stages: DashboardJourneyStage[] }) {
  const { t } = useTranslation()
  return (
    <Card className={styles.journey}>
      <div>
        <h2 className={styles.sectionTitle}>{t('dashboard.journey_title')}</h2>
        <p className={styles.journeyDescription}>{t('dashboard.journey_description')}</p>
      </div>
      <ol className={styles.journeyStages}>
        {stages.map((stage, index) => {
          const badgeVariant = stage.status === 'complete'
            ? 'success'
            : stage.status === 'attention'
              ? 'warning'
              : stage.status === 'blocked'
                ? 'error'
                : stage.status === 'current'
                  ? 'info'
                  : 'default'
          return (
            <li className={`${styles.journeyStage} ${styles[`journeyStage_${stage.status}`]}`} key={stage.id}>
              <div className={styles.journeyNumber}>{stage.status === 'complete' ? '✓' : index + 1}</div>
              <div className={styles.journeyContent}>
                <div className={styles.journeyHeader}>
                  <strong>{t(`dashboard.journey_stage_${stage.id}`)}</strong>
                  <Badge variant={badgeVariant}>{t(`dashboard.journey_status_${stage.status}`)}</Badge>
                </div>
                <span>{t(`dashboard.journey_${stage.detail}`)}</span>
              </div>
              {stage.status !== 'pending' && (
                <Link to={stage.to}>{t(stage.status === 'complete' ? 'dashboard.journey_review' : 'dashboard.journey_open')}</Link>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
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

function ExportReadinessPanel({ state, format }: { state: QuickReadinessState; format: ExportFormat }) {
  const { t, i18n } = useTranslation()
  const detailsUrl = `/preview?format=${format}`

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={`${styles.readiness} ${styles.readinessChecking}`} role="status">
        <span className={styles.readinessDot} />
        <div><strong>{t('dashboard.readiness_checking')}</strong><span>{t('dashboard.readiness_checking_desc')}</span></div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={`${styles.readiness} ${styles.readinessUnknown}`} role="status">
        <span className={styles.readinessDot} />
        <div><strong>{t('dashboard.readiness_unknown')}</strong><span>{t('dashboard.readiness_unknown_desc')}</span></div>
        <Link to={detailsUrl}>{t('dashboard.readiness_details')}</Link>
      </div>
    )
  }

  const { readiness } = state
  const firstWarning = state.blockingWarnings[0] ?? state.warnings[0]
  const remediationAction = firstWarning ? compatibilityRemediationAction(firstWarning) : null
  const visibleIssue = firstWarning
    ? (i18n.resolvedLanguage?.startsWith('zh') ? firstWarning.message : firstWarning.messageEn)
    : state.issue
      ? (i18n.resolvedLanguage?.startsWith('zh') ? state.issue.message : state.issue.messageEn)
      : undefined
  return (
    <div className={`${styles.readiness} ${styles[`readiness_${readiness.status}`]}`} role="status">
      <span className={styles.readinessDot} />
      <div>
        <strong>{t(`dashboard.readiness_${readiness.status}`)}</strong>
        <span>{visibleIssue ?? t(`dashboard.readiness_${readiness.status}_desc`, {
          partial: readiness.summary.partial,
          convert: readiness.summary.convert,
          unsupported: state.blockingWarnings.length,
        })}</span>
      </div>
      <div className={styles.readinessActions}>
        {remediationAction && <Link to={remediationAction.to}>{t(remediationAction.labelKey)}</Link>}
        <Link to={detailsUrl}>{t('dashboard.readiness_details')}</Link>
      </div>
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
