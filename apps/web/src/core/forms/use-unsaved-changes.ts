import { useCallback, useContext, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { UnsavedChangesContext } from './unsaved-changes-context'

export function useUnsavedChangesGuard(dirty: boolean) {
  const { t } = useTranslation()
  const confirmAction = useConfirmDialog()
  const register = useContext(UnsavedChangesContext)
  const idRef = useRef(Symbol('unsaved-form'))

  useEffect(() => {
    const id = idRef.current
    register?.(id, dirty)
    return () => register?.(id, false)
  }, [dirty, register])

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  return useCallback(async () => {
    if (!dirty) return true
    return confirmAction({
      title: t('common.unsaved_changes_title'),
      description: t('common.unsaved_changes_confirm'),
      confirmLabel: t('common.discard_changes'),
      danger: true,
    })
  }, [confirmAction, dirty, t])
}

export function formValuesEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
