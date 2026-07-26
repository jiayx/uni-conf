import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button/Button'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  closeDisabled?: boolean
  dirty?: boolean
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeDisabled = false,
  dirty = false,
}: ModalProps) {
  const { t } = useTranslation()
  const hasBody = children != null
  const contentRef = useRef<HTMLDivElement>(null)
  const [discardRequested, setDiscardRequested] = useState(false)

  useEffect(() => {
    if (!open || !dirty) setDiscardRequested(false)
  }, [dirty, open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && closeDisabled) return
    if (!nextOpen && dirty) {
      setDiscardRequested(true)
      return
    }
    onOpenChange(nextOpen)
  }

  const discardAndClose = () => {
    setDiscardRequested(false)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          ref={contentRef}
          className={`${styles.content} ${styles[size]} ${hasBody ? '' : styles.noBody}`}
          tabIndex={-1}
          onOpenAutoFocus={event => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
        >
          <div className={styles.header}>
            <div>
              <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              {description && <Dialog.Description className={styles.description}>{description}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <button type="button" className={styles.closeButton} aria-label={t('common.close')} disabled={closeDisabled}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </Dialog.Close>
          </div>
          {hasBody && <div className={styles.body}>{children}</div>}
          {(footer || discardRequested) && (
            <div className={styles.footer}>
              {discardRequested ? (
                <div className={styles.discardPrompt} role="alert">
                  <div className={styles.discardMessage}>
                    <strong>{t('common.unsaved_changes_title')}</strong>
                    <span>{t('common.unsaved_changes_close_confirm')}</span>
                  </div>
                  <div className={styles.discardActions}>
                    <Button variant="secondary" autoFocus onClick={() => setDiscardRequested(false)}>
                      {t('common.continue_editing')}
                    </Button>
                    <Button variant="danger" onClick={discardAndClose}>
                      {t('common.discard_changes')}
                    </Button>
                  </div>
                </div>
              ) : footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ModalClose({ children }: { children: ReactElement }) {
  return <Dialog.Close asChild>{children}</Dialog.Close>
}
