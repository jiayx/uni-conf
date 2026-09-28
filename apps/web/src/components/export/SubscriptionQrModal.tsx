import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal/Modal'
import styles from './SubscriptionQrModal.module.css'

export function SubscriptionQrModal({ subscription, onClose }: {
  subscription: { title: string; url: string } | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal open={Boolean(subscription)} onOpenChange={open => { if (!open) onClose() }}
      title={subscription?.title ?? ''} description={t('export.qr_security_hint')} size="sm">
      {subscription && <div className={styles.qr}>
        <QRCodeSVG value={subscription.url} size={240} level="M" marginSize={2} title={t('export.qr_image_label')} />
      </div>}
    </Modal>
  )
}
