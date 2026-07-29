import { useCallback, useEffect, useState } from 'react'
import type { Workspace } from '@uni-conf/types'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import {
  DEFAULT_WORKSPACE_ID,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from '@/lib/workspace'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { Modal } from '@/components/ui/Modal/Modal'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import styles from './WorkspaceSwitcher.module.css'

export function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const confirm = useConfirmDialog()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState(getActiveWorkspaceId)
  const [managerOpen, setManagerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingNames, setEditingNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const items = await api.workspaces.list()
    setWorkspaces(items)
    setEditingNames(Object.fromEntries(items.map((item) => [item.id, item.name])))
    if (!items.some((item) => item.id === activeId)) {
      setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)
      setActiveId(DEFAULT_WORKSPACE_ID)
    }
  }, [activeId])

  useEffect(() => {
    void load().catch(() => setError(t('workspaces.load_failed')))
  }, [load, t])

  const switchWorkspace = (id: string) => {
    if (id === activeId) return
    setActiveWorkspaceId(id)
    window.location.reload()
  }

  const createWorkspace = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(undefined)
    try {
      const created = await api.workspaces.create(name)
      setActiveWorkspaceId(created.id)
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaces.create_failed'))
      setBusy(false)
    }
  }

  const renameWorkspace = async (workspace: Workspace) => {
    const name = editingNames[workspace.id]?.trim()
    if (!name || name === workspace.name) return
    setBusy(true)
    setError(undefined)
    try {
      await api.workspaces.update(workspace.id, name)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaces.rename_failed'))
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkspace = async (workspace: Workspace) => {
    const accepted = await confirm({
      title: t('workspaces.delete_title'),
      description: t('workspaces.delete_confirm', { name: workspace.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!accepted) return
    setBusy(true)
    setError(undefined)
    try {
      await api.workspaces.remove(workspace.id)
      if (workspace.id === activeId) {
        setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)
        window.location.reload()
        return
      }
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaces.delete_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.switcher}>
        <div className={styles.controls}>
          <select
            id="workspace-switcher"
            className={styles.select}
            aria-label={t('workspaces.current')}
            value={activeId}
            onChange={(event) => switchWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.manageButton}
            onClick={() => setManagerOpen(true)}
            aria-label={t('workspaces.manage')}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>
      </div>

      <Modal
        open={managerOpen}
        onOpenChange={setManagerOpen}
        title={t('workspaces.manage')}
        description={t('workspaces.description')}
        size="md"
      >
        <div className={styles.createRow}>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('workspaces.name_placeholder')}
            maxLength={60}
          />
          <Button onClick={() => void createWorkspace()} loading={busy} disabled={!newName.trim()}>
            {t('common.add')}
          </Button>
        </div>

        <div className={styles.list}>
          {workspaces.map((workspace) => (
            <div className={styles.row} key={workspace.id}>
              <Input
                value={editingNames[workspace.id] ?? workspace.name}
                onChange={(event) => setEditingNames((current) => ({
                  ...current,
                  [workspace.id]: event.target.value,
                }))}
                maxLength={60}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || editingNames[workspace.id]?.trim() === workspace.name}
                onClick={() => void renameWorkspace(workspace)}
              >
                {t('common.save')}
              </Button>
              {!workspace.isDefault && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void deleteWorkspace(workspace)}
                >
                  {t('common.delete')}
                </Button>
              )}
            </div>
          ))}
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </Modal>
    </>
  )
}
