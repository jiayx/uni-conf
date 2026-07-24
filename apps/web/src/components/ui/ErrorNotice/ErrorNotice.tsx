import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ApiError } from '@/lib/api'
import { remediationAction } from '@/core/export/compatibility-remediation'
import { writeClipboardText } from '@/core/clipboard/write-text'
import styles from './ErrorNotice.module.css'

interface ErrorNoticeProps {
  error: unknown
  className?: string
  title?: string
}

export function ErrorNotice({ error, className = '', title }: ErrorNoticeProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : t('common.error')
  const diagnostic = error instanceof ApiError && error.requestId
    ? [error.code, error.requestId].filter(Boolean).join(' · ')
    : null
  const dependency = error instanceof ApiError ? error.details?.dependency : undefined
  const dependencies = error instanceof ApiError && error.details?.dependencies?.length
    ? error.details.dependencies
    : dependency
      ? [{ ...dependency, remediation: error instanceof ApiError ? error.details?.remediation : undefined }]
      : []

  const copyDiagnostic = async () => {
    if (!diagnostic) return
    setCopyFailed(false)
    try {
      await writeClipboardText(diagnostic)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <div className={`${styles.notice} ${className}`} role="alert">
      {title && <strong className={styles.title}>{title}</strong>}
      <span className={styles.message}>{message}</span>
      {dependencies.length > 0 && (
        <div className={styles.dependencies}>
          {dependencies.length > 1 && (
            <strong>{t('common.blocking_dependencies', { count: dependencies.length })}</strong>
          )}
          {dependencies.map((item, index) => {
            const action = remediationAction(item.remediation)
            return (
              <div className={styles.dependency} key={`${item.type}:${item.id ?? index}`}>
                <span>
                  {t('common.blocking_dependency', {
                    name: item.name ?? item.id ?? t('common.unknown'),
                  })}
                </span>
                {action && <Link to={action.to}>{t(action.labelKey)}</Link>}
              </div>
            )
          })}
        </div>
      )}
      {diagnostic && (
        <div className={styles.diagnostic}>
          <span>{t('common.diagnostic_reference')}</span>
          <code>{diagnostic}</code>
          <button type="button" onClick={() => void copyDiagnostic()}>
            {copied ? t('common.copied') : t('common.copy_diagnostic')}
          </button>
          {copyFailed && <span className={styles.copyFailed}>{t('common.clipboard_copy_failed')}</span>}
        </div>
      )}
    </div>
  )
}
