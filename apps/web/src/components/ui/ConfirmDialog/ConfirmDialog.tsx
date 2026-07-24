import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button/Button'
import { Modal } from '../Modal/Modal'
import { ConfirmDialogContext, type ConfirmDialogHandler, type ConfirmDialogOptions } from './useConfirmDialog'

type ConfirmDialogRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null)
  const requestRef = useRef<ConfirmDialogRequest | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    const current = requestRef.current
    if (!current) return
    requestRef.current = null
    setRequest(null)
    current.resolve(confirmed)
  }, [])

  const confirm = useCallback<ConfirmDialogHandler>((options) => new Promise<boolean>((resolve) => {
    if (requestRef.current) requestRef.current.resolve(false)
    const next = { ...options, resolve }
    requestRef.current = next
    setRequest(next)
  }), [])

  useEffect(() => () => {
    const current = requestRef.current
    requestRef.current = null
    current?.resolve(false)
  }, [])

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Modal
        open={request !== null}
        onOpenChange={open => { if (!open) settle(false) }}
        title={request?.title ?? t('common.confirm_action')}
        description={request?.description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>{t('common.cancel')}</Button>
            <Button variant={request?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {request?.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </ConfirmDialogContext.Provider>
  )
}
