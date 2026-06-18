import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useCollectionsStore } from '@/store/collections.store'
import styles from './Collections.module.css'

export function Collections() {
  const { t } = useTranslation()
  const { collections, loading, fetchCollections, addCollection, deleteCollection } = useCollectionsStore()
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => { void fetchCollections() }, [fetchCollections])

  const handleAdd = async () => {
    if (!name) return
    await addCollection({ name, sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'country', enabled: true })
    setShowModal(false); setName('')
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('collections.title')}
        actions={<Button onClick={() => setShowModal(true)} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('collections.new')}</Button>}
      />
      {loading && collections.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : collections.length === 0 ? (
        <EmptyState title="暂无节点组合" description="节点组合用于对订阅节点进行过滤、重命名和排序" action={{ label: t('collections.new'), onClick: () => setShowModal(true) }} />
      ) : (
        <div className={styles.grid}>
          {collections.map(col => (
            <Card key={col.id} className={styles.card}>
              <div className={styles.cardTitle}>{col.name}</div>
              <div className={styles.cardMeta}>
                <Badge variant="info">{col.sourceIds.length === 0 ? t('collections.all_sources') : `${col.sourceIds.length} 源`}</Badge>
                <Badge variant="default">{col.sort}</Badge>
                {col.filters.length > 0 && <Badge variant="warning">{col.filters.length} 过滤</Badge>}
              </div>
              <div className={styles.cardActions}>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此节点组合？')) void deleteCollection(col.id) }}>
                  删除
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={showModal} onOpenChange={setShowModal} title={t('collections.new')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleAdd()}>{t('common.save')}</Button></>}>
        <Input label={t('common.name')} value={name} onChange={e => setName(e.target.value)} placeholder="All Nodes" />
      </Modal>
    </div>
  )
}
