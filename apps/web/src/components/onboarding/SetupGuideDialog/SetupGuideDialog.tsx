import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'
import { summarizeDashboardSourceCreateResults } from '@/core/sources/dashboard-source-create'
import { parseSubscriptionUrls } from '@/core/sources/subscription-urls'
import {
  notifyDashboardDataChanged,
  SETUP_GUIDE_OPEN_EVENT,
} from '@/core/onboarding/setup-guide'
import { api } from '@/lib/api'
import styles from './SetupGuideDialog.module.css'

const DISMISSED_KEY = 'uni-conf:setup-guide-dismissed'

export function SetupGuideDialog() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const canSubmit = parseSubscriptionUrls(sourceUrl).length > 0

  useEffect(() => {
    let cancelled = false
    const openFromRequest = () => {
      setError(null)
      setOpen(true)
    }
    window.addEventListener(SETUP_GUIDE_OPEN_EVENT, openFromRequest)

    if (window.sessionStorage.getItem(DISMISSED_KEY) !== '1') {
      void api.dashboard.stats()
        .then(stats => {
          if (!cancelled && stats.sourceCount === 0 && stats.nodeCount === 0) {
            setOpen(true)
          }
        })
        .catch(() => undefined)
    }

    return () => {
      cancelled = true
      window.removeEventListener(SETUP_GUIDE_OPEN_EVENT, openFromRequest)
    }
  }, [])

  const close = () => {
    if (creating) return
    window.sessionStorage.setItem(DISMISSED_KEY, '1')
    setOpen(false)
  }

  const openManualNode = () => {
    close()
    void navigate('/nodes?create=1')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const urls = parseSubscriptionUrls(sourceUrl)
    if (urls.length === 0) return

    setCreating(true)
    setError(null)
    try {
      const results = await Promise.allSettled(urls.map(url => api.sources.create({ url })))
      const summary = summarizeDashboardSourceCreateResults(urls, results)
      setSourceUrl(summary.nextInput)

      if (summary.error?.kind === 'save-failed') {
        setError(t('sources.save_failed_count', {
          count: summary.error.count ?? 0,
          message: summary.error.message,
        }))
        return
      }
      if (summary.error?.kind === 'refresh-failed') {
        setError(t('dashboard.source_refresh_failed', { error: summary.error.message }))
        return
      }

      window.sessionStorage.removeItem(DISMISSED_KEY)
      setOpen(false)
      notifyDashboardDataChanged()
      void navigate('/')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) close()
      }}
      title={t(creating ? 'dashboard.setup_processing_title' : 'dashboard.setup_dialog_title')}
      description={t(creating ? 'dashboard.setup_processing_description' : 'dashboard.setup_description')}
      size="md"
      closeDisabled={creating}
    >
      {creating ? (
        <div className={styles.processing} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>{t('dashboard.setup_processing_status')}</strong>
            <span>{t('dashboard.setup_processing_hint')}</span>
          </div>
        </div>
      ) : (
        <form className={styles.form} onSubmit={event => void submit(event)}>
          <label className={styles.field}>
            <span>{t('sources.url')}</span>
            <textarea
              value={sourceUrl}
              onChange={event => setSourceUrl(event.target.value)}
              placeholder={t('sources.url_placeholder')}
              required
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'setup-guide-error' : undefined}
            />
          </label>
          {error && <div id="setup-guide-error" className={styles.error} role="alert">{error}</div>}
          <Button type="submit" disabled={!canSubmit}>{t('dashboard.setup_submit')}</Button>
          <div className={styles.alternatives}>
            <span>{t('dashboard.setup_other_methods')}</span>
            <button type="button" onClick={openManualNode}>{t('nodes.add_manual')}</button>
            <Link to="/sources" onClick={close}>{t('dashboard.setup_manage_sources')}</Link>
          </div>
        </form>
      )}
    </Modal>
  )
}
