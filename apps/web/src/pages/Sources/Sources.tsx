import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useSourcesStore } from '@/store/sources.store'
import type { ProxySource, SourceFormat } from '@uni-conf/types'
import styles from './Sources.module.css'

const FORMAT_OPTIONS: { value: SourceFormat; label: string }[] = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'clash', label: 'Clash / Mihomo' },
  { value: 'singbox', label: 'sing-box' },
  { value: 'base64', label: 'Base64 nodes' },
  { value: 'surge', label: 'Surge' },
  { value: 'loon', label: 'Loon' },
]

export function Sources() {
  const { t } = useTranslation()
  const { sources, loading, fetchSources, addSource, updateSource, deleteSource, refreshSource } = useSourcesStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', url: '', format: 'auto' as SourceFormat, updateInterval: 0, notes: '' })

  useEffect(() => { void fetchSources() }, [fetchSources])

  const handleAdd = async () => {
    if (!form.name || !form.url) return
    await addSource({
      name: form.name, type: 'url', url: form.url, format: form.format,
      enabled: true, tags: [], updateInterval: form.updateInterval, notes: form.notes,
    })
    setShowAddModal(false)
    setForm({ name: '', url: '', format: 'auto', updateInterval: 0, notes: '' })
  }

  const handleRefresh = async (id: string) => {
    setRefreshingId(id)
    try { await refreshSource(id) } finally { setRefreshingId(null) }
  }

  const handleToggle = (source: ProxySource) => {
    void updateSource(source.id, { enabled: !source.enabled })
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('sources.title')}
        actions={
          <Button onClick={() => setShowAddModal(true)} icon={<PlusIcon />}>
            {t('sources.add_url')}
          </Button>
        }
      />

      {loading && sources.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<SubscriptionIcon />}
          title="暂无订阅源 / No subscriptions"
          description="添加机场订阅链接或手动节点来开始使用 / Add a subscription URL or manual nodes to get started"
          action={{ label: t('sources.add_url'), onClick: () => setShowAddModal(true) }}
        />
      ) : (
        <div className={styles.grid}>
          {sources.map(source => (
            <Card key={source.id} className={styles.sourceCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>{source.name}</div>
                <div className={styles.cardActions}>
                  <button
                    className={`${styles.toggleBtn} ${source.enabled ? styles.enabled : styles.disabled}`}
                    onClick={() => handleToggle(source)}
                    title={source.enabled ? t('common.disable') : t('common.enable')}
                  />
                  <Button
                    variant="ghost" size="sm"
                    loading={refreshingId === source.id}
                    onClick={() => handleRefresh(source.id)}
                    title={t('sources.refresh_now')}
                  >
                    <RefreshIcon />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { if (confirm(t('sources.delete_confirm'))) void deleteSource(source.id) }}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
              <div className={styles.cardMeta}>
                <Badge variant={source.enabled ? 'success' : 'default'}>
                  {source.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
                <Badge variant="info">{source.format.toUpperCase()}</Badge>
              </div>
              <div className={styles.cardUrl}>{source.url}</div>
              <div className={styles.cardStats}>
                <span>{t('sources.node_count')}: <strong>{source.nodeCount}</strong></span>
                {source.lastUpdated && (
                  <span>{t('sources.last_updated')}: {new Date(source.lastUpdated).toLocaleString()}</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        title={t('sources.add_url')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleAdd()}>{t('common.save')}</Button>
          </>
        }
      >
        <Input
          label={t('common.name')}
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="My Airport"
        />
        <Input
          label={t('sources.url')}
          value={form.url}
          onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          placeholder="https://example.com/sub?token=..."
        />
        <div>
          <label className={styles.selectLabel}>{t('sources.format')}</label>
          <select
            className={styles.select}
            value={form.format}
            onChange={e => setForm(f => ({ ...f, format: e.target.value as SourceFormat }))}
          >
            {FORMAT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <Input
          label={t('sources.update_interval')}
          type="number"
          value={form.updateInterval}
          onChange={e => setForm(f => ({ ...f, updateInterval: Number(e.target.value) }))}
          helperText={t('sources.update_interval_hint')}
        />
        <Input
          label={t('common.notes')}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder={t('common.notes')}
        />
      </Modal>
    </div>
  )
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function RefreshIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
}
function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
function SubscriptionIcon() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
}
