import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { PREVIEW_FORMATS } from '@/core/export/formats'
import { summarizeExportWarnings } from '@/core/export/warning-summary'
import { api } from '@/lib/api'
import type { CompatibilityWarning, ExportConfig, ExportFormat } from '@uni-conf/types'
import styles from './Preview.module.css'

export function Preview() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [format, setFormat] = useState<ExportFormat>(() => parsePreviewFormat(searchParams.get('format')))
  const [configs, setConfigs] = useState<ExportConfig[]>([])
  const [configId, setConfigId] = useState(() => searchParams.get('configId') ?? '')
  const [content, setContent] = useState('')
  const [contentType, setContentType] = useState('')
  const [warnings, setWarnings] = useState<CompatibilityWarning[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const warningSummary = summarizeExportWarnings(warnings)
  const canUseConfig = content && warningSummary.canUseConfig

  const loadConfigs = useCallback(async () => {
    try {
      setConfigs(await api.export.listConfigs())
    } catch {
      setConfigs([])
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadConfigs()
    })
  }, [loadConfigs])

  const handlePreview = useCallback(async () => {
    setLoading(true)
    setPreviewError(null)
    try {
      const result = await api.export.previewFormat(format, configId || undefined)
      setContent(result.content)
      setContentType(result.contentType)
      setWarnings(result.warnings ?? [])
    } catch (e) {
      setContent('')
      setContentType('')
      setWarnings([])
      setPreviewError((e as Error).message)
    } finally { setLoading(false) }
  }, [configId, format])

  useEffect(() => {
    queueMicrotask(() => {
      void handlePreview()
    })
  }, [handlePreview])

  const handleCopy = () => {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('preview.title')} />
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {PREVIEW_FORMATS.map(f => (
            <button key={f} className={`${styles.tab} ${format === f ? styles.active : ''}`} onClick={() => setFormat(f)}>
              {t(`export.formats.${f}`)}
            </button>
          ))}
        </div>
        <select className={styles.select} value={configId} onChange={e => setConfigId(e.target.value)}>
          <option value="">{t('preview.default_config')}</option>
          {configs.map(config => (
            <option key={config.id} value={config.id}>
              {config.name} ({config.format})
            </option>
          ))}
        </select>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void handlePreview()}>
            {t('common.preview')}
          </Button>
          {content && (
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          )}
        </div>
      </div>
      {previewError && (
        <div className={styles.error}>
          <strong>{t('preview.error')}</strong>
          <span>{previewError}</span>
        </div>
      )}
      {content ? (
        <>
          <div className={styles.meta}>
            <span>{contentType}</span>
            <span>{t('preview.line_count', { count: content.split('\n').length })}</span>
          </div>
          {!loading && !previewError && (
            <div className={`${styles.summary} ${canUseConfig ? styles.summaryReady : styles.summaryBlocked}`}>
              <strong>
                {canUseConfig ? t('preview.ready_title') : t('preview.blocked_title')}
              </strong>
              <span>
                {warnings.length === 0
                  ? t('preview.ready_desc')
                  : t('preview.warning_summary', {
                    unsupported: warningSummary.unsupported,
                    partial: warningSummary.partial,
                    convert: warningSummary.convert,
                  })}
              </span>
            </div>
          )}
          {warnings.length > 0 && (
            <div className={styles.warnings}>
              {warnings.map((warning, index) => (
                <div key={`${warning.level}-${index}`} className={`${styles.warning} ${styles[warning.level]}`}>
                  {warning.message}
                </div>
              ))}
            </div>
          )}
          {!loading && !previewError && warnings.length === 0 && (
            <div className={`${styles.warning} ${styles.full}`}>{t('preview.no_warnings')}</div>
          )}
          <pre className={styles.code}>{content}</pre>
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
