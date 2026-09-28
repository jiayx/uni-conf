import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/Button/Button'
import { IconActionButton } from '@/components/ui/IconActionButton/IconActionButton'
import { Modal } from '@/components/ui/Modal/Modal'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { buildUniversalSubscriptionUrl } from '@/core/export/quick-subscriptions'
import { maskSubscriptionTokenUrl } from '@/core/sources/source-url-privacy'
import { writeClipboardText } from '@/core/clipboard/write-text'
import styles from './UniversalSubscriptionLinks.module.css'

export function UniversalSubscriptionLinks({ origin, token, enabled = true, revealed = false }: {
  origin: string
  token?: string | null
  enabled?: boolean
  revealed?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  const [qrMode, setQrMode] = useState<'config' | 'nodes' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const available = Boolean(token) && enabled
  const qrUrl = available && qrMode ? buildUniversalSubscriptionUrl(origin, token!, qrMode) : null

  const copy = async (mode: 'config' | 'nodes', url: string) => {
    setError(null)
    try {
      await writeClipboardText(url)
      setCopied(mode)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 2000)
    } catch {
      setError(new Error(t('common.clipboard_copy_failed')))
    }
  }

  return (
    <div className={styles.list}>
      {error != null && <ErrorNotice error={error} />}
      {(['config', 'nodes'] as const).map(mode => {
        const url = token ? buildUniversalSubscriptionUrl(origin, token, mode) : ''
        const title = t(`export.universal_${mode}`)
        return (
          <div key={mode} className={styles.row}>
            <div className={styles.info}>
              <strong>{title}</strong>
              <p>{t(`export.universal_${mode}_hint`)}</p>
              {revealed && url && <code>{url}</code>}
              {!revealed && url && <code>{maskSubscriptionTokenUrl(url)}{mode === 'nodes' ? '?mode=nodes' : ''}</code>}
            </div>
            <div className={styles.actions}>
              <IconActionButton action={copied === mode ? 'copied' : 'copy'} disabled={!available}
                aria-label={copied === mode ? t('common.copied') : t('export.copy_universal', { name: title })}
                onClick={() => void copy(mode, url)} />
              <Button variant="ghost" size="sm" disabled={!available}
                aria-label={t('export.qr_title', { name: title })}
                onClick={() => setQrMode(mode)}>{t('export.scan_to_add')}</Button>
            </div>
          </div>
        )
      })}
      <Modal open={Boolean(qrUrl)} onOpenChange={open => { if (!open) setQrMode(null) }}
        title={qrMode ? t(`export.universal_${qrMode}`) : ''} description={t('export.qr_security_hint')} size="sm">
        {qrUrl && <div className={styles.qr}><QRCodeSVG value={qrUrl} size={240} level="M" marginSize={2} title={t('export.qr_image_label')} /></div>}
      </Modal>
    </div>
  )
}
