import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { UnsavedChangesContext, type DirtyRegistration } from './unsaved-changes-context'

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const confirmAction = useConfirmDialog()
  const [dirtyForms, setDirtyForms] = useState<Set<symbol>>(() => new Set())
  const confirmingRef = useRef(false)
  const blocker = useBlocker(dirtyForms.size > 0)

  const register = useCallback<DirtyRegistration>((id, dirty) => {
    setDirtyForms(current => {
      const contains = current.has(id)
      if (contains === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (blocker.state !== 'blocked' || confirmingRef.current) return
    confirmingRef.current = true
    void confirmAction({
      title: t('common.unsaved_changes_title'),
      description: t('common.unsaved_changes_confirm'),
      confirmLabel: t('common.discard_changes'),
      danger: true,
    }).then(confirmed => {
      confirmingRef.current = false
      if (blocker.state !== 'blocked') return
      if (confirmed) blocker.proceed()
      else blocker.reset()
    })
  }, [blocker, confirmAction, t])

  return (
    <UnsavedChangesContext.Provider value={register}>
      {children}
    </UnsavedChangesContext.Provider>
  )
}
