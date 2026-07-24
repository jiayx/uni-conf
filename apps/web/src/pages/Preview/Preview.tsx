import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { ConfigContentPreview } from '@/components/export/ConfigContentPreview/ConfigContentPreview'
import { CompatibilityWarningNotice } from '@/components/export/CompatibilityWarningNotice/CompatibilityWarningNotice'
import { TransformationReport } from '@/components/export/TransformationReport/TransformationReport'
import { countContentLines, FULL_CONTENT_PREVIEW_LIMITS } from '@/core/export/content-preview'
import { PREVIEW_FORMATS } from '@/core/export/formats'
import { exportWarningSummaryText, summarizeExportWarnings } from '@/core/export/warning-summary'
import { writeClipboardText } from '@/core/clipboard/write-text'
import { api } from '@/lib/api'
import type {
  CompatibilityWarning,
  ExportArtifactValidationResult,
  ExportCapabilityProfile,
  ExportConfig,
  ExportDownloadReadiness,
  ExportFormat,
} from '@uni-conf/types'
import styles from './Preview.module.css'

export function Preview() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const format = parsePreviewFormat(searchParams.get('format'))
  const [configs, setConfigs] = useState<ExportConfig[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [configsError, setConfigsError] = useState<unknown | null>(null)
  const configId = searchParams.get('configId') ?? ''
  const [content, setContent] = useState('')
  const [contentType, setContentType] = useState('')
  const [capabilityProfile, setCapabilityProfile] = useState<ExportCapabilityProfile | null>(null)
  const [warnings, setWarnings] = useState<CompatibilityWarning[]>([])
  const [artifactValidation, setArtifactValidation] = useState<ExportArtifactValidationResult | null>(null)
  const [readiness, setReadiness] = useState<ExportDownloadReadiness>({ ready: false, blockingWarnings: [] })
  const [previewError, setPreviewError] = useState<unknown | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<unknown | null>(null)
  const previewRequestId = useRef(0)
  const warningSummary = summarizeExportWarnings(warnings)
  const diagnosticWarnings = useMemo(
    () => warnings.filter(warning => !warning.transformation),
    [warnings],
  )
  const canUseConfig = Boolean(content && readiness.ready && previewError == null && !loading)
  const contentLineCount = useMemo(() => countContentLines(content), [content])

  const selectFormat = (nextFormat: ExportFormat) => {
    if (nextFormat === format) return
    const next = new URLSearchParams(searchParams)
    next.set('format', nextFormat)
    setSearchParams(next)
  }

  const selectConfig = (nextConfigId: string) => {
    if (nextConfigId === configId) return
    const next = new URLSearchParams(searchParams)
    if (nextConfigId) next.set('configId', nextConfigId)
    else next.delete('configId')
    setSearchParams(next)
  }

  const loadConfigs = useCallback(async () => {
    setConfigsLoading(true)
    setConfigsError(null)
    try {
      setConfigs(await api.export.listConfigs())
    } catch (error) {
      setConfigsError(error)
    } finally {
      setConfigsLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadConfigs()
    })
  }, [loadConfigs])

  const handlePreview = useCallback(async (preserveExisting = false) => {
    const requestId = ++previewRequestId.current
    setLoading(true)
    setPreviewError(null)
    setCopyError(null)
    setCopied(false)
    if (!preserveExisting) {
      setContent('')
      setContentType('')
      setCapabilityProfile(null)
      setWarnings([])
      setArtifactValidation(null)
      setReadiness({ ready: false, blockingWarnings: [] })
    }
    try {
      const result = await api.export.previewFormat(format, configId || undefined)
      if (previewRequestId.current !== requestId) return
      setContent(result.content)
      setContentType(result.contentType)
      setCapabilityProfile(result.capabilityProfile)
      setWarnings(result.warnings ?? [])
      setArtifactValidation(result.artifactValidation)
      setReadiness(result.readiness)
    } catch (e) {
      if (previewRequestId.current !== requestId) return
      setPreviewError(e)
    } finally {
      if (previewRequestId.current === requestId) setLoading(false)
    }
  }, [configId, format])

  useEffect(() => {
    queueMicrotask(() => {
      void handlePreview(false)
    })
    return () => {
      previewRequestId.current += 1
    }
  }, [handlePreview])

  const handleCopy = async () => {
    if (!canUseConfig) return
    setCopyError(null)
    try {
      await writeClipboardText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(new Error(t('common.clipboard_copy_failed')))
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('preview.title')} />
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {PREVIEW_FORMATS.map(f => (
            <button
              key={f}
              type="button"
              className={`${styles.tab} ${format === f ? styles.active : ''}`}
              aria-pressed={format === f}
              onClick={() => selectFormat(f)}
            >
              {t(`export.formats.${f}`)}
            </button>
          ))}
        </div>
        <select
          className={styles.select}
          aria-label={t('preview.config_selector')}
          aria-busy={configsLoading}
          value={configId}
          onChange={event => selectConfig(event.target.value)}
        >
          <option value="">{t('preview.default_config')}</option>
          {configs.map(config => (
            <option key={config.id} value={config.id}>
              {config.name} ({config.format})
            </option>
          ))}
        </select>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void handlePreview(true)}>
            {content ? t('common.refresh') : t('common.preview')}
          </Button>
          {content && (
            <Button variant="ghost" size="sm" disabled={!canUseConfig} onClick={() => void handleCopy()}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          )}
        </div>
      </div>
      {configsError != null && (
        <div className={styles.configLoadFailure}>
          <ErrorNotice
            error={configsError}
            title={t('preview.config_load_error_title')}
            className={styles.error}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={configsLoading}
            onClick={() => void loadConfigs()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {previewError != null && (
        <ErrorNotice error={previewError} title={t('preview.error')} className={styles.error} />
      )}
      {copyError != null && <ErrorNotice error={copyError} className={styles.error} />}
      {content ? (
        <>
          <div className={styles.meta}>
            <span>{contentType}</span>
            <span>{t('preview.line_count', { count: contentLineCount })}</span>
            {capabilityProfile && (
              <span title={t('preview.capability_profile_help')}>
                {t('preview.capability_profile', {
                  format: capabilityProfile.format,
                  revision: capabilityProfile.revision,
                })}
              </span>
            )}
            {artifactValidation && (
              <span className={artifactValidation.valid ? styles.structureValid : styles.structureInvalid}>
                {artifactValidation.valid
                  ? t('preview.structure_valid', { kind: artifactValidation.kind.toUpperCase() })
                  : t('preview.structure_invalid', { count: artifactValidation.issues.length })}
              </span>
            )}
          </div>
          {!loading && !previewError && (
            <div className={`${styles.summary} ${canUseConfig ? styles.summaryReady : styles.summaryBlocked}`}>
              <strong>
                {canUseConfig ? t('preview.ready_title') : t('preview.blocked_title')}
              </strong>
              <span>
                {warnings.length === 0
                  ? t('preview.ready_desc')
                  : exportWarningSummaryText(warningSummary, t, readiness)}
              </span>
            </div>
          )}
          {!loading && previewError && (
            <div className={`${styles.summary} ${styles.summaryBlocked}`} role="status">
              <strong>{t('preview.stale_title')}</strong>
              <span>{t('preview.stale_after_refresh_error')}</span>
            </div>
          )}
          <TransformationReport warnings={warnings} />
          {diagnosticWarnings.length > 0 && (
            <div className={styles.warnings}>
              {diagnosticWarnings.map((warning, index) => (
                <CompatibilityWarningNotice
                  key={`${warning.level}-${index}`}
                  warning={warning}
                  className={`${styles.warning} ${styles[warning.level]}`}
                />
              ))}
            </div>
          )}
          {!loading && !previewError && warnings.length === 0 && (
            <div className={`${styles.warning} ${styles.full}`}>{t('preview.no_warnings')}</div>
          )}
          <ConfigContentPreview
            content={content}
            codeClassName={styles.code}
            {...FULL_CONTENT_PREVIEW_LIMITS}
          />
        </>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyText}>{loading ? t('preview.generating') : t('preview.empty')}</div>
        </div>
      )}
    </div>
  )
}

function parsePreviewFormat(value: string | null): ExportFormat {
  return PREVIEW_FORMATS.includes(value as ExportFormat) ? value as ExportFormat : 'mihomo'
}
