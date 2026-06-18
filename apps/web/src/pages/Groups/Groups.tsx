import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useGroupsStore } from '@/store/groups.store'
import type { GroupType } from '@uni-conf/types'
import styles from './Groups.module.css'

const GROUP_TYPE_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  select: 'purple', 'url-test': 'info', fallback: 'warning', 'load-balance': 'success', direct: 'default', reject: 'error',
}

export function Groups() {
  const { t } = useTranslation()
  const { groups, loading, fetchGroups, addGroup, deleteGroup } = useGroupsStore()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'select' as GroupType })

  useEffect(() => { void fetchGroups() }, [fetchGroups])

  const handleAdd = async () => {
    if (!form.name) return
    await addGroup({ name: form.name, type: form.type, collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 999, isBuiltin: false })
    setShowModal(false); setForm({ name: '', type: 'select' })
  }

  const typeLabel = (type: string) => ({
    select: t('groups.type_select'), 'url-test': t('groups.type_url_test'),
    fallback: t('groups.type_fallback'), 'load-balance': t('groups.type_load_balance'),
    direct: t('groups.type_direct'), reject: t('groups.type_reject'),
  }[type] ?? type)

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('groups.title')}
        actions={<Button onClick={() => setShowModal(true)} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('groups.new')}</Button>}
      />
      {loading ? <div className={styles.loading}>{t('common.loading')}</div> : (
        <div className={styles.list}>
          {groups.map(g => (
            <Card key={g.id} className={styles.groupCard}>
              <div className={styles.cardLeft}>
                <div className={styles.groupName}>{g.name}</div>
                <div className={styles.groupMeta}>
                  <Badge variant={GROUP_TYPE_COLORS[g.type] ?? 'default'}>{typeLabel(g.type)}</Badge>
                  {g.isBuiltin && <Badge variant="default">{t('groups.builtin_label')}</Badge>}
                </div>
              </div>
              {!g.isBuiltin && (
                <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此策略组？')) void deleteGroup(g.id) }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </Button>
              )}
            </Card>
          ))}
          {groups.length === 0 && <EmptyState title="暂无策略组" action={{ label: t('groups.new'), onClick: () => setShowModal(true) }} />}
        </div>
      )}
      <Modal open={showModal} onOpenChange={setShowModal} title={t('groups.new')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleAdd()}>{t('common.save')}</Button></>}>
        <Input label={t('common.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Proxy Group" />
        <div>
          <label className={styles.selectLabel}>{t('common.type')}</label>
          <select className={styles.select} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as GroupType }))}>
            <option value="select">{t('groups.type_select')}</option>
            <option value="url-test">{t('groups.type_url_test')}</option>
            <option value="fallback">{t('groups.type_fallback')}</option>
            <option value="load-balance">{t('groups.type_load_balance')}</option>
          </select>
        </div>
      </Modal>
    </div>
  )
}
